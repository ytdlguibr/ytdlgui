#!/usr/bin/env bash
set -Eeuo pipefail

"$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/update_sidecars.sh" --windows
