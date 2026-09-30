#!/usr/bin/env bash
# Bounded API env loader. Resolves apps/web/.env (or $CLUB_ATHLETIC_WEB_ENV_FILE),
# rejects missing/malformed input, exports it WITHOUT printing values, changes into
# apps/web, and execs the supplied command so Prisma/tests/CLI run with server
# secrets present but never echoed to stdout.
set -Eeuo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
web_dir="$(cd "${script_dir}/.." && pwd)"
env_file="${CLUB_ATHLETIC_WEB_ENV_FILE:-${web_dir}/.env}"

if (( $# == 0 )); then
  echo "with-env: a command is required" >&2
  exit 1
fi

# shellcheck source=./scripts/dotenv.sh
source "${script_dir}/dotenv.sh"
load_dotenv_file "${env_file}"

cd "${web_dir}"
exec "$@"
