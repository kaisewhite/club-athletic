#!/usr/bin/env bash
# Dedicated trip agent only; no roster or skill reconciliation.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bun --no-env-file "${SCRIPT_DIR}/deploy.ts" agents "$@"
