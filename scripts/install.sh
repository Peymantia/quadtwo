#!/usr/bin/env bash
# Thin wrapper so both paths work:
#   bash <(curl -Ls .../install.sh)
#   bash <(curl -Ls .../scripts/install.sh)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec bash "${ROOT}/install.sh" "$@"
