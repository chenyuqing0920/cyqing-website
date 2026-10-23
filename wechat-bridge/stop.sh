#!/usr/bin/env bash
# 停止微信桥接收发服务
set -uo pipefail
cd "$(dirname "$0")"
if [ -f state/serve.lock ]; then
    pid="$(cat state/serve.lock)"
    if kill -0 "$pid" 2>/dev/null; then
        kill -TERM "$pid"
        echo "stopped pid=$pid"
        exit 0
    fi
fi
echo "not running"
