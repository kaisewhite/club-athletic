#!/bin/sh

set -eu

export AWS_REGION="us-east-1"
AWS_PROFILE="mostrom_mgmt"
CDK_OUTPUT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/cdk-out.XXXXXX")"
STACK_IDS_FILE="$(mktemp "${TMPDIR:-/tmp}/cdk-stacks.XXXXXX")"
CDK_STACKS_FILE="$(mktemp "${TMPDIR:-/tmp}/cdk-all-stacks.XXXXXX")"

STACK_PATTERNS_REGEX="club-athletic"

# `cdk list` synthesises the app, so it fails whenever the app fails. Its output is
# captured on its own and its exit status checked before any filtering: piping it straight
# into grep discards that status, and the `|| true` that used to end the pipeline turned a
# synth crash into the misleading "No stacks matched patterns" with a success exit code.
CDK_LIST_OUTPUT="$(mktemp "${TMPDIR:-/tmp}/cdk-list.XXXXXX")"
trap 'rm -rf "$CDK_OUTPUT_DIR" "$STACK_IDS_FILE" "$CDK_STACKS_FILE" "$CDK_LIST_OUTPUT"' EXIT

if ! cdk list --profile "$AWS_PROFILE" > "$CDK_LIST_OUTPUT" 2>&1; then
  echo "cdk list failed - the app did not synthesise. Output:" >&2
  cat "$CDK_LIST_OUTPUT" >&2
  exit 1
fi

# CDK prints the deployable construct id followed by the configured CloudFormation
# name, e.g. `InfraStack (club-athletic-prod-cdk)`. Keep both: filter against the
# configured name, but pass the construct id back to `cdk deploy`. dotenv's
# informational lines are intentionally ignored.
awk '
  NF == 1 { print $1 "\t" $1; next }
  $2 ~ /^\([^()]+\)$/ { name = $2; gsub(/[()]/, "", name); print $1 "\t" name }
' "$CDK_LIST_OUTPUT" | sort -u > "$CDK_STACKS_FILE"

if [ -n "${STACK_NAMES:-}" ]; then
  : > "$STACK_IDS_FILE"
  for requested_stack in $STACK_NAMES; do
    stack_id="$(awk -F '\t' -v requested="$requested_stack" '$1 == requested || $2 == requested { print $1; exit }' "$CDK_STACKS_FILE")"
    if [ -z "$stack_id" ]; then
      echo "Requested stack was not returned by cdk list: $requested_stack" >&2
      echo "Available stacks:" >&2
      cut -f2 "$CDK_STACKS_FILE" >&2
      exit 1
    fi
    printf '%s\n' "$stack_id" >> "$STACK_IDS_FILE"
  done
else
  awk -F '\t' -v pattern="$STACK_PATTERNS_REGEX" '$2 ~ pattern { print $1 }' "$CDK_STACKS_FILE" > "$STACK_IDS_FILE"
fi

if [ ! -s "$STACK_IDS_FILE" ]; then
  echo "No stacks matched patterns: $STACK_PATTERNS_REGEX" >&2
  echo "cdk list returned:" >&2
  cat "$CDK_LIST_OUTPUT" >&2
  exit 1
fi

set --
while IFS= read -r stack_name; do
  set -- "$@" "$stack_name"
done < "$STACK_IDS_FILE"

printf 'Deploying %s stack(s):\n' "$#"
printf '  %s\n' "$@"

# `cdk deploy` synthesizes once for the full selection. Do not run a separate `cdk synth`
# here; doing so doubles asset work, and looping stack-by-stack repeats bundling for the
# same app graph.
# Reattach named, retained resources left behind by a deleted stack. CloudFormation
# only auto-imports eligible unmanaged resources; their data stays in place.
cdk deploy "$@" --profile "$AWS_PROFILE" --require-approval never --import-existing-resources --output "$CDK_OUTPUT_DIR"
