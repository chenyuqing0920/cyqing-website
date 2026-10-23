#!/usr/bin/env bash
# 随手存 + 文件小站 一键拉起（Muse 的 Linux 环境专用）
# 拓扑：公网隧道 -> 7860 前置代理 proxy.py
#         /files*  -> 7864 文件小站（~/workspace/services/file-drop）
#         其余     -> 7863 随手存 linux_server.py
# 隧道：Cloudflare 命名隧道 muse-vm（cloudflare-lab/cf-tunnel-start.sh 拉起
#       代理版 cloudflared-proxy），域名 tool.cyqing.icu 走 HTTPS。
#       Serveo 与 localhost.run 均已于 2026-10-21 按阿庆决定停用，不再拉起。
# 托管：本地三件套与隧道均为 systemd 单元（douyin-server / file-drop /
#       douyin-proxy / cloudflared-proxy，均 enabled + Restart=always），
#       本脚本优先走 systemctl 拉起，单元源文件在 ./systemd/ 与
#       cloudflare-lab/，/etc 被重置时自动重装；systemd 不可用才回落 nohup。
# 用法：./start.sh   重复运行安全：已在跑的进程不会重复启动。
# 状态：logs/、url.txt（当前公网地址）；密码在 data/remote-access.json 与
#       file-drop/data/password.txt，均不写入脚本与日志。
set -uo pipefail
cd "$(dirname "$0")"
PROJECT="$HOME/workspace/projects/douyin-direct-downloader"
FILEDROP="$HOME/workspace/services/file-drop"
mkdir -p data logs
export DOUYIN_DATA_DIR="$PWD/data"

# systemd 优先：三件套单元源文件在 ./systemd/，VM 替换导致 /etc 被重置时
# 自动重装并 enable（与 cf-tunnel-start.sh 同策略）；systemd 不可用才回落 nohup。
SYSTEMD_OK=0
if command -v systemctl >/dev/null 2>&1 && [ "$(ps -p 1 -o comm= 2>/dev/null)" = "systemd" ]; then
    SYSTEMD_OK=1
    for u in douyin-server file-drop douyin-proxy; do
        if ! cmp -s "$PWD/systemd/$u.service" "/etc/systemd/system/$u.service" 2>/dev/null; then
            cp "$PWD/systemd/$u.service" "/etc/systemd/system/$u.service" 2>/dev/null && systemctl daemon-reload 2>/dev/null
        fi
        systemctl enable "$u" >/dev/null 2>&1 || true
    done
    # 微信桥：单元源文件在 wechat-bridge/，同策略重装+拉起
    # （2026-10-22 补：桥 13:29 接入 systemd 后 14:08 被 /etc 重置带走，
    #  此前脚本未覆盖导致桥停摆 6.5 小时无人发现）
    if ! cmp -s "$HOME/workspace/wechat-bridge/wechat-bridge.service" "/etc/systemd/system/wechat-bridge.service" 2>/dev/null; then
        cp "$HOME/workspace/wechat-bridge/wechat-bridge.service" "/etc/systemd/system/wechat-bridge.service" 2>/dev/null && systemctl daemon-reload 2>/dev/null
    fi
    systemctl enable wechat-bridge >/dev/null 2>&1 || true
    systemctl start wechat-bridge >/dev/null 2>&1 || true
    # GitHub 自动同步定时器：单元源文件在 services/github-sync/，同策略重装
    # （2026-10-23 补：随手存仓库每小时与 GitHub 双向同步）
    for u in github-sync.service github-sync.timer; do
        if ! cmp -s "$HOME/workspace/services/github-sync/$u" "/etc/systemd/system/$u" 2>/dev/null; then
            cp "$HOME/workspace/services/github-sync/$u" "/etc/systemd/system/$u" 2>/dev/null && systemctl daemon-reload 2>/dev/null
        fi
    done
    systemctl enable github-sync.timer >/dev/null 2>&1 || true
    systemctl start github-sync.timer >/dev/null 2>&1 || true
fi
start_unit() { # $1=unit 名；成功返回 0
    [ "$SYSTEMD_OK" = "1" ] && systemctl start "$1" 2>/dev/null
}

# 迁移：停掉旧版直占 7860 的随手存进程（新版在 7863，7860 让给代理）
if pgrep -f "linux_server.py --port 7860" > /dev/null; then
    pkill -f "linux_server.py --port 7860"
    sleep 1
    echo "legacy server on 7860 stopped"
fi

if ! curl -s -o /dev/null --max-time 3 http://127.0.0.1:7863/; then
    if ! start_unit douyin-server; then
        setsid nohup "$PROJECT/.venv/bin/python" "$PROJECT/linux_server.py" --port 7863 \
            > logs/server.log 2>&1 &
    fi
    echo "server started (7863)"
fi

if ! curl -s -o /dev/null --max-time 3 http://127.0.0.1:7864/files/; then
    if ! start_unit file-drop; then
        (cd "$FILEDROP" && setsid nohup .venv/bin/python app.py < /dev/null > logs/app.log 2>&1 &)
    fi
    echo "file-drop started (7864)"
fi

for i in $(seq 1 20); do
    curl -s -o /dev/null --max-time 2 http://127.0.0.1:7863/ && \
    curl -s -o /dev/null --max-time 2 http://127.0.0.1:7864/files/ && break
    sleep 1
done

if ! curl -s -o /dev/null --max-time 3 http://127.0.0.1:7860/; then
    if ! start_unit douyin-proxy; then
        setsid nohup python3 "$PWD/proxy.py" > logs/proxy.log 2>&1 &
    fi
    echo "proxy started (7860)"
fi
for i in $(seq 1 20); do
    curl -s -o /dev/null --max-time 2 http://127.0.0.1:7860/ && break
    sleep 1
done

"$HOME/workspace/services/cloudflare-lab/cf-tunnel-start.sh"

echo "https://tool.cyqing.icu" > url.txt
echo "public url: https://tool.cyqing.icu"
