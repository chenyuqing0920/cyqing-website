#!/usr/bin/env bash
# 手动恢复 personal-life-space（VM 更换导致 /etc 单元丢失时使用）。
# 仅重装并启动本服务，不重启、不修改现有代理、隧道、随手存、文件小站
# 及其同步自动化。自动恢复能力未经 VM 重建实测，本脚本只保证手动恢复路径。
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
unit_src="$repo_root/deploy/muse/personal-life-space.service"
[ -f "$unit_src" ] || { echo '单元源文件不存在' >&2; exit 1; }
state_root="${LIFE_STATE_DIR:-$HOME/workspace/services/personal-life-space}"
[ -f "$state_root/site.env" ] || { echo "独立环境配置不存在（$state_root/site.env），请先运行 deploy/muse/prepare.sh" >&2; exit 1; }
install -m 0644 "$unit_src" /etc/systemd/system/personal-life-space.service
systemctl daemon-reload
systemctl enable --now personal-life-space.service
systemctl status personal-life-space.service --no-pager || true
# 服务启动需要几秒（Prisma 初始化、绑定端口），单次检查会误报失败。
for i in $(seq 1 30); do
  if curl -fsS --max-time 5 http://127.0.0.1:7870/life/api/health >/dev/null 2>&1; then
    echo '恢复完成。'
    exit 0
  fi
  sleep 1
done
echo '服务已启动，但健康检查 30 秒内未通过，请查看日志' >&2
exit 1
