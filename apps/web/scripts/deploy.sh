#!/usr/bin/env bash
# Build the image, push it to ECR, and roll the ECS service.
#
#   ./scripts/deploy.sh
#
# Re-exec under real bash: macOS /bin/sh is bash in POSIX mode, where arrays and
# process substitution are syntax errors, so `sh scripts/deploy.sh` would fail.
[ -n "${DEPLOY_BASH:-}" ] || exec env DEPLOY_BASH=1 bash "$0" "$@"
set -euo pipefail

cd "$(dirname "$0")/.."

PROFILE=mostrom_mgmt
REGION=us-east-1
ACCOUNT=366394957699
CLUSTER=club-athletic
SERVICE=web
NAME=club-athletic-web
IMAGE="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com/${NAME}"
ENV_FILE="${ENV_FILE:-.env}"

# Secrets go to the task, not the image: the Dockerfile refuses build args and
# .dockerignore excludes .env, so ECS injects these from Secrets Manager at start.
echo "==> Secrets"
source scripts/dotenv.sh
load_dotenv_file "$ENV_FILE"
payload="$(mktemp)"; trap 'rm -f "$payload"' EXIT
args=(); filter='{}'
for key in $(dotenv_file_keys "$ENV_FILE"); do
  [[ -n "${!key+set}" ]] || continue
  args+=(--arg "$key" "${!key}"); filter+=" | .\"$key\" = \$$key"
done
jq -n "${args[@]}" "$filter" > "$payload"
aws secretsmanager put-secret-value --secret-id "$NAME" --secret-string "file://$payload" \
  --profile "$PROFILE" --region "$REGION" --query VersionId --output text

echo "==> Build and push"
aws ecr get-login-password --region "$REGION" --profile "$PROFILE" \
  | docker login --username AWS --password-stdin "${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"

# --platform is required: the task definition runs X86_64, and an arm64 image
# built on a Mac dies at container start with `exec format error`.
docker build --platform linux/amd64 -t "$NAME" .
docker tag "$NAME" "${IMAGE}:main"
docker push "${IMAGE}:main"

echo "==> Deploy"
aws ecs update-service --cluster "$CLUSTER" --service "$SERVICE" --force-new-deployment \
  --profile "$PROFILE" --region "$REGION" --no-cli-pager --query 'service.deployments[0].id' --output text
aws ecs wait services-stable --cluster "$CLUSTER" --services "$SERVICE" \
  --profile "$PROFILE" --region "$REGION"
echo "==> Done"
