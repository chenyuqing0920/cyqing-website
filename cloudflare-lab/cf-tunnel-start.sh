#!/bin/bash
# Start the patched cloudflared (named tunnel) for tool.cyqing.icu.
# Preferred mode: systemd unit cloudflared-proxy (Restart=always, enabled).
# If the installed unit is missing or outdated (e.g. VM replaced and /etc
# was reset), reinstall it from the durable copy kept next to this script.
# Falls back to a nohup process only when systemd is unavailable.
# Idempotent: exits quietly when the tunnel is already running.
# Requires ~/.cloudflared/config.yml + credentials JSON (see config template).
set -u
LAB="$HOME/workspace/services/cloudflare-lab"
BIN="$LAB/cloudflared-proxy"
LOG="$LAB/logs/cf-tunnel.log"
UNIT_SRC="$LAB/cloudflared-proxy.service"
UNIT_DST="/etc/systemd/system/cloudflared-proxy.service"
mkdir -p "$LAB/logs"

if [ ! -f "$HOME/.cloudflared/config.yml" ]; then
    echo "$(date -Is) no ~/.cloudflared/config.yml yet - tunnel not provisioned" >> "$LOG"
    exit 1
fi

if command -v systemctl >/dev/null 2>&1 && [ "$(ps -p 1 -o comm= 2>/dev/null)" = "systemd" ]; then
    if ! cmp -s "$UNIT_SRC" "$UNIT_DST" 2>/dev/null; then
        if cp "$UNIT_SRC" "$UNIT_DST" 2>/dev/null; then
            systemctl daemon-reload 2>/dev/null
            echo "$(date -Is) installed systemd unit cloudflared-proxy" >> "$LOG"
        fi
    fi
    systemctl enable cloudflared-proxy >/dev/null 2>&1 || true
    if systemctl is-active --quiet cloudflared-proxy; then
        exit 0
    fi
    if systemctl start cloudflared-proxy 2>/dev/null; then
        echo "$(date -Is) started cloudflared-proxy via systemd" >> "$LOG"
        exit 0
    fi
    echo "$(date -Is) systemctl start failed, falling back to nohup" >> "$LOG"
fi

if pgrep -f "cloudflared-proxy tunnel.*run" >/dev/null 2>&1; then
    exit 0
fi
nohup "$BIN" tunnel --config "$HOME/.cloudflared/config.yml" run >> "$LOG" 2>&1 &
echo "$(date -Is) started cloudflared-proxy pid $! (nohup fallback)" >> "$LOG"
