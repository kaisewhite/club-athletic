#!/usr/bin/env bash
# Mirror apps/web/.env into the `club-athletic-<stage>-web` Secrets Manager secret,
# which ECS injects into the task at start. Nothing runtime is ever baked into the
# image, so the task cannot start until this has run at least once.
#
#   ./scripts/push-secrets.sh <dev|stage|prod>
#   ENV_FILE=/path/to/other.env ./scripts/push-secrets.sh dev
#   DRY_RUN=true ./scripts/push-secrets.sh dev        # print key names, write nothing
#
# Ported from `edge/apps/api/scripts/push-secrets.sh`. Two deliberate differences:
#
#  1. `edge` reads `.env.production`; we read `.env`. There is one Neon database and
#     one credential for this trip — no per-stage env file, no role split.
#  2. Like `edge`, this pushes EVERY variable in the file. It is a backup/sync
#     utility, not a policy gate: do not add per-key allowlists, value validation or
#     forbidden-key checks here. The task definition in `apps/aws` declares which
#     keys it injects into the container; keys the container does not ask for sit in
#     the secret inertly. (`apps/aws/scripts/push-secrets.sh` is the filtered
#     alternative, deriving its key list from `properties/index.ts`. Either is safe
#     here because apps/web/.env holds nothing but this app's own config.)
#
# Values are never printed — only key names and the resulting version id.
set -euo pipefail

app_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

stage="${1:-}"
case "${stage}" in
  dev | stage | prod) ;;
  *) echo "usage: $(basename "$0") <dev|stage|prod>" >&2; exit 2 ;;
esac

env_file="${ENV_FILE:-$app_root/.env}"
secret_id="${SECRET_ID:-club-athletic-${stage}-web}"

if [ ! -f "$env_file" ]; then
  echo "error: missing env file: $env_file" >&2
  exit 1
fi
command -v jq >/dev/null 2>&1 || { echo "missing required command: jq" >&2; exit 1; }
command -v aws >/dev/null 2>&1 || { echo "missing required command: aws" >&2; exit 1; }

# Parse every KEY=VALUE line into a JSON object: skip comments/blank lines, tolerate a
# leading `export `, require a valid shell identifier as the key, and strip a trailing CR
# plus one layer of surrounding double quotes from the value.
secret="$(jq -Rn '
  reduce inputs as $line ({};
    ($line | sub("^[[:space:]]*(export[[:space:]]+)?"; "")) as $l
    | if ($l | test("^[[:space:]]*(#|$)")) then .
      elif ($l | test("^[A-Za-z_][A-Za-z0-9_]*[[:space:]]*=")) then
        ($l | capture("^(?<key>[A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=(?<value>.*)$")) as $kv
        | . + {($kv.key): ($kv.value | rtrimstr("\r") | ltrimstr("\"") | rtrimstr("\""))}
      else . end)' < "$env_file")"

if [ -z "$secret" ] || [ "$secret" = "{}" ]; then
  echo "error: no secret entries found in $env_file" >&2
  exit 1
fi

echo "==> $secret_id <- $env_file"
printf '%s' "$secret" | jq -r 'to_entries | map("    " + .key + " (" + (.value | length | tostring) + " chars)") | .[]'

if [ "${DRY_RUN:-false}" = "true" ]; then
  echo "==> DRY_RUN=true; nothing written."
  exit 0
fi

AWS_PROFILE="${AWS_PROFILE:-mostrom_mgmt}"
AWS_REGION="${AWS_REGION:-us-east-1}"
export AWS_PROFILE AWS_REGION

printf '%s' "$secret" | aws secretsmanager put-secret-value \
  --region "$AWS_REGION" \
  --secret-id "$secret_id" \
  --secret-string file:///dev/stdin \
  --query "{secret:Name,version:VersionId}" \
  --output json
