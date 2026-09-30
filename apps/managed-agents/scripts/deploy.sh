#!/usr/bin/env bash
# Environment then dedicated agent. Preview by default; never creates sessions.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bun --no-env-file "${SCRIPT_DIR}/deploy.ts" all "$@"
