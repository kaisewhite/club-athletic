#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"

AWS_PROFILE="${AWS_PROFILE:-mostrom_mgmt}"
AWS_REGION="${AWS_REGION:-us-east-1}"
DRY_RUN="${DRY_RUN:-false}"
SERVICE_NAME="${1:?usage: push-secrets.sh <service-name> <env-file>}"
ENV_FILE="${2:?usage: push-secrets.sh <service-name> <env-file>}"
SECRET_NAME="club-athletic-${SERVICE_NAME}"

if [[ ! "${SERVICE_NAME}" =~ ^[a-z0-9-]+$ ]]; then
  echo "invalid service name: ${SERVICE_NAME}" >&2
  exit 2
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "environment file not found: ${ENV_FILE}" >&2
  exit 1
fi

command -v aws >/dev/null 2>&1 || { echo "missing required command: aws" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "missing required command: node" >&2; exit 1; }

SECRET_FILE="$(mktemp "${TMPDIR:-/tmp}/club-athletic-${SERVICE_NAME}-secret.XXXXXX")"
trap 'rm -f "${SECRET_FILE}"' EXIT

# Parse dotenv syntax in Node so quoted values, embedded equals signs, and
# comments are handled without exposing secret material to shell evaluation.
NODE_PATH="${REPO_ROOT}/apps/aws/node_modules" node - "${ENV_FILE}" "${SECRET_FILE}" <<'NODE'
const fs = require("node:fs");
const dotenv = require("dotenv");

const [, , source, destination] = process.argv;
const parsed = dotenv.parse(fs.readFileSync(source));
const entries = Object.fromEntries(
  Object.entries(parsed).filter(([key]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)),
);
if (Object.keys(entries).length === 0) {
  throw new Error("environment file did not contain any variables");
}
fs.writeFileSync(destination, JSON.stringify(entries));
console.log(`prepared ${Object.keys(entries).length} secret variables`);
NODE

echo "Updating Secrets Manager secret ${SECRET_NAME} from ${ENV_FILE}"
if [[ "${DRY_RUN}" == "true" ]]; then
  echo "DRY RUN: skipped Secrets Manager update"
  exit 0
fi

aws secretsmanager put-secret-value \
  --secret-id "${SECRET_NAME}" \
  --secret-string "file://${SECRET_FILE}" \
  --profile "${AWS_PROFILE}" \
  --region "${AWS_REGION}" \
  --query 'VersionId' \
  --output text

echo "Updated ${SECRET_NAME}"
