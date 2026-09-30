#!/usr/bin/env bash
# Build, push and deploy apps/web for one stage, by hand.
#
#   ./scripts/deploy-local.sh prod
#
# Ported from `edge/apps/api/scripts/deploy-local.sh`, keeping its shape and
# adapting the names to what `apps/aws` actually synthesizes:
#
#   ECR repository   club-athletic-web             (image tag `main` — the tag the
#                                                   task definition references)
#   ECS cluster      edge
#   ECS service      club-athletic-web
#
# The flow, in order: resolve the account -> ECR login -> docker build -> docker push
# -> force a new deployment -> wait for the service to stabilize.
#
# Built with NO build-args carrying configuration. Runtime env comes from the
# `club-athletic-<stage>-web` Secrets Manager secret, injected by ECS at task start.
# Provision the production secret with real values before the first service deploy.
# When apps/web/.env changes, sync it first (./scripts/push-secrets.sh prod) so new
# tasks pick up the new secret version.
#
# The service's health check is GET /health on :4173 every 10s. If the image cannot
# serve that, the deployment circuit breaker rolls back and `wait services-stable`
# fails — which is the intended loud failure.
#
# No tests, no dry run: this pushes an image and replaces the running task.
# Overridable: AWS_PROFILE, AWS_REGION, IMAGE_TAG, DESIRED_COUNT, PLATFORM.
set -euo pipefail

app_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

stage="${1:-}"
case "${stage}" in
  prod) ;;
  *) echo "usage: $(basename "$0") prod" >&2; exit 2 ;;
esac

AWS_PROFILE="${AWS_PROFILE:-mostrom_prod}"
AWS_REGION="${AWS_REGION:-us-east-1}"
export AWS_PROFILE AWS_REGION

expected_account="736548610362"
service="club-athletic-web"
cluster="edge"
repo="club-athletic-web"
image_tag="${IMAGE_TAG:-main}"
desired_count="${DESIRED_COUNT:-1}"
# The task definition declares no RuntimePlatform, so ECS runs it as LINUX/X86_64.
# Building on an Apple Silicon machine without this produces an arm64 image that
# ECS pulls and then fails to start with an exec format error.
platform="${PLATFORM:-linux/amd64}"

command -v docker >/dev/null 2>&1 || { echo "missing required command: docker" >&2; exit 1; }
command -v aws >/dev/null 2>&1 || { echo "missing required command: aws" >&2; exit 1; }

account="$(aws sts get-caller-identity --query Account --output text)"
if [ "$account" != "$expected_account" ]; then
  echo "error: profile $AWS_PROFILE resolved to account $account; expected $expected_account" >&2
  exit 1
fi
ecr_uri="${account}.dkr.ecr.${AWS_REGION}.amazonaws.com/${repo}"

echo "==> ECR login ($ecr_uri)"
aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$ecr_uri"

echo "==> Building $ecr_uri:$image_tag ($platform)"
docker build --no-cache --platform "$platform" -t "$ecr_uri:$image_tag" "$app_root"

echo "==> Pushing $ecr_uri:$image_tag"
docker push "$ecr_uri:$image_tag"

echo "==> Force-deploying ECS service $service on cluster $cluster (desired-count $desired_count)"
aws ecs update-service --cluster "$cluster" --service "$service" \
  --desired-count "$desired_count" --force-new-deployment --region "$AWS_REGION" \
  --query "service.{name:serviceName,status:status,desired:desiredCount}" --output json

echo "==> Waiting for service to stabilize (health check: GET /health on :4173)..."
aws ecs wait services-stable --cluster "$cluster" --service "$service" --region "$AWS_REGION"
echo "==> Done. $service is stable on the new image ($ecr_uri:$image_tag)."
