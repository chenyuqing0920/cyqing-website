#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
state_root="${LIFE_STATE_DIR:-$HOME/workspace/services/personal-life-space}"
case "$state_root" in /*) ;; *) echo 'LIFE_STATE_DIR 必须为绝对路径' >&2; exit 1;; esac
case "$state_root/" in "$repo_root/"*|/tmp/*|/var/tmp/*) echo '状态目录不能放在代码目录或临时目录' >&2; exit 1;; esac
umask 077
mkdir -p "$state_root/data" "$state_root/uploads"
state_real="$(cd "$state_root" && pwd -P)"
case "$state_real/" in "$repo_root/"*|/tmp/*|/var/tmp/*) echo '状态目录实际路径不安全' >&2; exit 1;; esac
node_bin="$(command -v node)"
[ -n "$node_bin" ] || { echo '需要 Node.js 22 或以上' >&2; exit 1; }
env_file="$state_real/site.env"
if [ ! -e "$env_file" ]; then
  secret="$("$node_bin" -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")"
  cat > "$env_file" <<EOF
DATABASE_URL=file:$state_real/data/space.db
SESSION_SECRET=$secret
PORT=7870
HOST=127.0.0.1
NODE_ENV=production
UPLOAD_DIR=$state_real/uploads
PUBLIC_BASE_URL=http://127.0.0.1:7870
COOKIE_SECURE=false
TRUST_PROXY=0
BASE_PATH=/life
LEGACY_BASE_URL=https://tool.cyqing.icu
NODE_BIN=$node_bin
EOF
  unset secret
  chmod 600 "$env_file"
  echo '已创建独立环境配置；初始设置仅允许本机测试。'
else
  echo '保留现有环境配置，不覆盖。'
fi
set -a
# This file is private configuration created by the owner, not untrusted input.
. "$env_file"
set +a
case "${DATABASE_URL:-}" in "file:$state_real/data/"*) ;; *) echo '数据库必须位于独立状态目录 data/ 内' >&2; exit 1;; esac
[ "${UPLOAD_DIR:-}" = "$state_real/uploads" ] || { echo '上传目录必须位于独立状态目录 uploads/ 内' >&2; exit 1; }
db_path="${DATABASE_URL#file:}"
if [ ! -e "$db_path" ]; then : > "$db_path"; fi
cd "$repo_root"
npm ci --include=dev --no-audit --no-fund
npx prisma generate
npx prisma migrate deploy
npm run build
echo '准备完成。使用管理员创建脚本，随后仅启动独立服务。'
