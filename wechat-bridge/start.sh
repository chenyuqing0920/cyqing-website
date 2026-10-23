#!/usr/bin/env bash
# 启动微信桥接收发服务（重复运行安全：已在跑则不重复启动）
set -uo pipefail
cd "$(dirname "$0")"
mkdir -p logs state
if [ -f state/serve.lock ] && kill -0 "$(cat state/serve.lock)" 2>/dev/null; then
    echo "already running pid=$(cat state/serve.lock)"
    exit 0
fi
setsid nohup .venv/bin/python bridge.py serve >> logs/serve.out 2>&1 &
echo "serve started"
sleep 2
.venv/bin/python bridge.py status
