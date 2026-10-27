#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
state_root="${LIFE_STATE_DIR:-$HOME/workspace/services/personal-life-space}"
env_file="$state_root/site.env"
[ -f "$env_file" ] || { echo '独立环境配置不存在，请先运行 prepare.sh' >&2; exit 1; }
set -a
. "$env_file"
set +a
cd "$repo_root"
exec "${NODE_BIN:-node}" server/index.js
