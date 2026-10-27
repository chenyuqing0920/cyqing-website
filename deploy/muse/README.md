# Muse 原生部署

此目录只管理新站，不重启或修改现有代理、隧道、随手存或文件小站。以下路径与端口必须在实际 Muse 环境复核：源码 `~/workspace/projects/personal-life-space`；代码外持久状态 `~/workspace/services/personal-life-space`；仅监听 `127.0.0.1:7870`；应用路径 `/life/`。初始配置只供本机测试，不自动修改域名路由。

## 准备和本机测试

```bash
cd ~/workspace/projects/personal-life-space
bash deploy/muse/prepare.sh
```

`prepare.sh` 不覆盖已有环境配置或数据库；它在状态目录中保存 `site.env`（0600）、`data/space.db`、`uploads/`，并以 `BASE_PATH=/life` 进行构建和迁移。不要将 `site.env`、数据库、备份、上传文件放入仓库。生成管理员密码时，用户在安全的终端中输入：

```bash
set -a; . ~/workspace/services/personal-life-space/site.env; set +a
read -rs -p '管理员密码（至少12位）: ' ADMIN_PASSWORD; echo
printf '%s' "$ADMIN_PASSWORD" | node scripts/admin.js --password-stdin
unset ADMIN_PASSWORD
bash deploy/muse/run.sh
```

本机验证 `http://127.0.0.1:7870/life/` 和 `/life/api/health`，并测试登录、私密数据、上传、备份恢复、服务重启、子路径静态资源。初始阶段 `PUBLIC_BASE_URL=http://127.0.0.1:7870`、`COOKIE_SECURE=false`，不可将此配置暴露到公网。

Muse 环境说明：若 `npm ci` 在 `@prisma/engines` 的 postinstall 处以 ECONNRESET 失败，是 Node 的下载请求被出口代理重置（同地址用 curl 可通）。不要反复全量重装：先 `npm ci --ignore-scripts`，再用 curl（支持断点续传）从 Prisma 官方 binaries 主机拉取与当前 Prisma 版本对应的引擎 `.gz`，解压到 `node_modules/@prisma/engines/`（CLI 的 query engine 与 schema engine）和 `node_modules/prisma/`（generate 用的 client engine），然后再跑 `prisma generate`、`migrate deploy` 和构建。引擎版本与系统目标以本机 `node_modules/@prisma/engines` 的版本和 get-platform 输出为准，不要照抄旧值。

## 独立 systemd 服务

确认系统支持且拥有安装权限后，仅安装此新单元；其源文件保留在仓库中，以便系统目录被重置时恢复：

```bash
sudo install -m 0644 deploy/muse/personal-life-space.service /etc/systemd/system/personal-life-space.service
sudo systemctl daemon-reload
sudo systemctl enable --now personal-life-space.service
sudo systemctl status personal-life-space.service
sudo systemctl stop personal-life-space.service
sudo systemctl start personal-life-space.service
sudo systemctl restart personal-life-space.service
journalctl -u personal-life-space.service -n 100 --no-pager
journalctl -u personal-life-space.service -f
```

此单元使用实际运行用户 `root`（本环境不存在 hatch 用户），HOME=/home/hatch 指向工作区所在位置，源码路径如上。若当前环境不同，先调整本单元副本，不改已有单元。`/etc` 如果在 VM 更换时被重置，单元可能消失；此时手动运行 `bash deploy/muse/recover.sh` 重新安装并启动（不碰现有服务及其自动化），恢复脚本本身不声称自动恢复，VM 重建后的自动恢复能力未经实测。数据文件持久性同样需要实际验证，不能仅凭位置保证。

## 正式域名接入

先完成本机功能、安全和备份验收，再单独设计现有前置代理的 `/life/` 路由。它应将完整 `/life/...` 路径转发至 `127.0.0.1:7870`，不可把新站的 `/api` 或 `/assets` 转给随手存；不要改动其他路径。构建和服务的 `BASE_PATH` 必须保持一致。公网 HTTPS 前，将新站 `site.env` 的 `PUBLIC_BASE_URL` 改成 `https://tool.cyqing.icu`（只写源站，不加 `/life`），设置 `COOKIE_SECURE=true`，并在可信代理正确设置 `X-Forwarded-Proto: https` 后启用 `TRUST_PROXY=1`。否则 Secure 会话 Cookie 可能无法登录。仅重启新服务，逐项验证老站首页、`/douyin/`、`/files/`、新站 `/life/` 和登录；出问题先回滚新路由。

## 更新与回滚

先备份状态目录中的数据库和上传文件并验证恢复；检查 Git 工作区干净，再 `git fetch` 和 `git merge --ff-only origin/main`（主分支即新站内容；personal-life-space 分支已并入主分支、仅作历史保留）。运行 `bash deploy/muse/prepare.sh` 安装锁定依赖、执行迁移和构建，然后 `sudo systemctl restart personal-life-space.service` 并检查日志与健康接口。避免自动提交、自动合并冲突或清理数据。若数据库迁移无法逆向，回滚代码前先恢复匹配版本的数据库备份。
