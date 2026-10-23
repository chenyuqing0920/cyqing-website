#!/usr/bin/env bash
# Serveo 自定义域名隧道一键拉起：tool.cyqing.icu -> 本机 7860 前置代理。
# 2026-10-21 阿庆决定停用 localhost.run，正式入口改为自有域名 + Serveo。
# 幂等且自愈：进程在但公网不是 200（例如 Serveo 免费转发到期 expired、
# ssh 进程假活）时，杀掉旧进程重新拉起。日志：logs/serveo-tunnel.log。
set -uo pipefail
cd "$(dirname "$0")"
mkdir -p logs

if pgrep -f "serveo_tunnel" > /dev/null; then
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://tool.cyqing.icu/ || echo 000)"
    if [ "$code" = "200" ]; then
        echo "serveo tunnel healthy"
        exit 0
    fi
    echo "serveo process alive but public check=$code, restarting" >> logs/serveo-tunnel.log
    pkill -f "serveo_tunnel" || true
    sleep 2
fi

setsid nohup ssh -o StrictHostKeyChecking=accept-new \
    -o IdentitiesOnly=yes -i "$HOME/.ssh/serveo_tunnel" \
    -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
    -o ExitOnForwardFailure=yes \
    -o "ProxyCommand=node $PWD/proxy-connect.js %h %p" \
    -R tool.cyqing.icu:80:127.0.0.1:7860 serveo.net \
    > logs/serveo-tunnel.log 2>&1 &
echo "serveo tunnel started"
