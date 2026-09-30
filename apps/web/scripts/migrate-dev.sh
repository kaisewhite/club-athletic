#!/usr/bin/env bash
# Apply committed Prisma migrations to the development database from apps/web/.env.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
web_dir="$(cd "${script_dir}/.." && pwd)"

CLUB_ATHLETIC_WEB_ENV_FILE="${web_dir}/.env" bash "${script_dir}/with-env.sh" bunx prisma migrate deploy
CLUB_ATHLETIC_WEB_ENV_FILE="${web_dir}/.env" bash "${script_dir}/with-env.sh" bunx prisma migrate status
