# 星光里的生活手帐

个人旅行、追番、笔记和工具箱。网站提供私人管理后台和公开前台，支持上传图片、持久化、草稿与备份恢复。采用 Node.js、React、SQLite 和 Prisma Migration，代码与持久数据分离。原有个人网站和随手存没有被覆盖。

## 本机预览

当前本机地址：<http://127.0.0.1:3070/>。管理员用户名 `admin`；初始密码以 Windows DPAPI 加密保存在 `data/admin-access.json`，密码在数据库中以 bcrypt 哈希存储。请在创建该密码的 Windows 账户下运行：

```powershell
cd 'D:\codex\个人网站\digital-space'
powershell -ExecutionPolicy Bypass -File .\scripts\show-admin-password.ps1
```

当前 SQLite 数据库和上传图片位于 `%LOCALAPPDATA%\PersonalLifeSpace\`，独立于代码目录。此前本机 PostgreSQL 数据和迁移前的本机敏感备份仍保留；现有旅行、追番、图片及草稿已通过备份恢复到 SQLite。演示记录均为虚构，其中包含浏览器验收用的私密旅行和笔记草稿，可自行编辑或删除。

启动已有环境（保持窗口打开）：

```powershell
cd 'D:\codex\个人网站\digital-space'
powershell -ExecutionPolicy Bypass -File .\scripts\start-local.ps1
```

脚本执行 Prisma 迁移、生产构建并启动应用。已有服务占用 3070 时不要重复启动。

## 新环境初始化

Windows：安装 Node.js 22 或 24 和 Git，在项目目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\init-local.ps1
# 可选，仅在对应表为空时创建虚构示例
npm run db:seed
```

脚本创建独立的本机 SQLite 文件、上传目录、会话密钥和管理员，遇到已有 `.env` 或数据库不会覆盖。密码仅以哈希保存在数据库，Windows 的临时查看凭据使用 DPAPI 加密。

Linux / Muse：先选择确定持久的**代码目录外**的状态目录，在该目录创建 `space.db` 空文件与 `uploads/`，在独立的配置文件中设置 `DATABASE_URL=file:/绝对路径/space.db`、`UPLOAD_DIR=/绝对路径/uploads`、`SESSION_SECRET`、`PUBLIC_BASE_URL`、`HOST=127.0.0.1` 和独立 `PORT`。设置随机会话密钥后在源代码目录运行：

```bash
npm ci --include=dev
npx prisma generate
npx prisma migrate deploy
npm run build
# 管理员密码仅通过标准输入提供，不写入文件或命令参数
read -rs -p '管理员密码（至少12位）: ' ADMIN_PASSWORD; echo
printf '%s' "$ADMIN_PASSWORD" | node scripts/admin.js --password-stdin
unset ADMIN_PASSWORD
node server/index.js
```

应用不提供公开注册。Linux 后台守护及具体路径请参阅 `deploy/muse/README.md`；请先核实目标机器的持久化和 systemd 状态，避免覆盖已有服务。`PUBLIC_BASE_URL` 必须等于浏览器访问的协议、域名和端口，末尾不要加 `/`，用于校验写请求来源。随手存和文件小站由本站 Express 同源反代（见下节），浏览器只访问本站一个网站。

## 备份与恢复

登录后台 →「备份与恢复」→ 下载 JSON。备份包含记录、草稿、标签、工具数据、网站设置以及图片；不包含管理员哈希、会话或应用密钥。备份含私人数据，应妥善保管。图片合计超过 80 MB 时，使用 SQLite 官方在线备份方式备份数据库并同时备份 `UPLOAD_DIR`，不要仅复制正在使用的数据库主文件而忽略 WAL。

恢复会替换当前记录与图片索引，先下载当前备份。服务先检查数据和图片哈希，再以数据库事务恢复；新图片使用新文件名，旧图片文件保留以便人工恢复。恢复不修改管理员账户。部署升级前，先备份数据库和上传目录并验证恢复。

## Docker（可选）

Muse 采用原生运行。Docker Compose 用于隔离测试或其他 Linux 服务器：

```powershell
$taskSecret = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLower()
@("SESSION_SECRET=$taskSecret", 'PUBLIC_BASE_URL=http://127.0.0.1:3070', 'COOKIE_SECURE=false') | Set-Content -Encoding utf8 .env.docker
docker compose --env-file .env.docker up --build -d
$taskAdminSecure = Read-Host '设置至少 12 位管理员密码' -AsSecureString
$taskPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskAdminSecure)
try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskPointer) | docker compose --env-file .env.docker exec -T app node scripts/admin.js --password-stdin } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskPointer) }
# 可选虚构示例
docker compose --env-file .env.docker exec -T app node scripts/seed.js
```

SQLite 文件和上传图片保存在 `state` 持久卷，普通 stop / restart 不删除它。不要使用 `down -v`，除非已经完成备份。生产环境需通过 HTTPS 代理，设置正确的 `PUBLIC_BASE_URL`、`COOKIE_SECURE=true`；仅当反向代理可信时设置 `TRUST_PROXY=1`。Compose 默认只绑定本机，`APP_PORT` 可改宿主机端口。

## 开发与验证

`npm run dev` 启动 API 和 Vite 开发服务；`npm run build` 生产构建。数据库模型和迁移位于 `prisma/`，上一个 PostgreSQL 原型的 schema 与迁移保留在 `prisma/postgresql-reference/`，不由当前 SQLite 自动执行。标签以 SQLite JSON 数组随记录保存，后台批量重命名和删除时使用事务更新相关记录及草稿。

集成测试使用独立数据库，名称必须包含 `digital_space_test`，不要指向正式数据库：

```powershell
$taskDb = Join-Path $env:LOCALAPPDATA 'PersonalLifeSpace\data\digital_space_test_sqlite.db'
if (-not (Test-Path $taskDb)) { [IO.File]::WriteAllBytes($taskDb,[byte[]]@()) }
$env:TEST_DATABASE_URL = 'file:' + $taskDb.Replace('\','/')
$env:DATABASE_URL = $env:TEST_DATABASE_URL
npx prisma migrate deploy
npm test
```

测试覆盖登录、CSRF、私人内容隔离、跨独立会话读取、旅行及动漫更新、图片访问、草稿、备份恢复和重启。浏览器使用示例数据验证了表单、地图、Markdown 图片和移动布局。真实手机、公网 HTTPS 和 Muse VM 重建后的持久性要以部署后实测为准。

首页原创封面由内置 imagegen 生成：`public/anime-hero.png` 为蓝调樱花湖夜景，`public/anime-hero-day.png` 为白日樱花河谷。地图使用 Leaflet 和 OpenStreetMap，不依赖付费地图 API。


## 随手存 / 文件小站（同源并入主站，免密）

两个工具都由主站 Express 同源反向代理，浏览器只访问一个网站（CSP `connect-src 'self'` 不用放宽）：

| 浏览器路径（含 `BASE_PATH`） | 上游 | 上游收到的路径 |
| --- | --- | --- |
| `{BASE_PATH}/files/...` | `FILE_DROP_URL`（默认 `http://127.0.0.1:7864`） | `/files/...`（原样） |
| `{BASE_PATH}/douyin/...` | `DOUYIN_URL`（默认 `http://127.0.0.1:7863`） | `/...`（去掉 `/douyin`） |

生产（Muse，`BASE_PATH=/life`）即 `https://tool.cyqing.icu/life/files/...`、`/life/douyin/...`；前端统一用 `import.meta.env.BASE_URL` 拼前缀。

环境变量（都可选）：

- `FILE_DROP_URL` / `DOUYIN_URL`：上游地址。设 `TOOLS_USE_LEGACY=1` 时（且未设前两者），两者都转发到 `LEGACY_BASE_URL` 前置代理（保留 `/files`、`/douyin` 前缀）。
- `FILE_DROP_MAX_MB`：单次上传上限，默认 `2048`。随手存请求体固定 64 KB 上限。
- `TOOL_WRITE_LIMIT_PER_MIN`（默认 60）/ `TOOL_READ_LIMIT_PER_MIN`（默认 600）：每 IP 每工具限速。
- `TOOL_UPSTREAM_TIMEOUT_MS`：上游空闲超时，默认 120000。

行为：没有访问密码；写操作（上传、删除、提交、取消）必须同源（`Origin` 与 Host 或 `PUBLIC_BASE_URL` 一致），否则 403；上游连不上返回 JSON `502`（超时 `504`），`{"upstream":"unreachable"}`，不会落到 SPA 页面；请求和响应都流式转发，大文件不进内存。

> 风险提示：免密意味着任何知道网址的人都能上传、下载、删除文件和提交下载任务，请勿在文件小站存放隐私文件，必要时在前置代理加 IP 白名单。

### 本地联调

开发时 Vite（5173）把 `/api`、`/files`、`/douyin` 都交给 Express（3070），再由它反代到 7863 / 7864，与生产同一条路径。

```powershell
# 终端 1：星光手帐
cd digital-space
npm run dev

# 终端 2：随手存（免密）
cd douyin
& "D:\codex\抖音视频下载\.venv\Scripts\python.exe" linux_server.py --port 7863

# 终端 3：文件小站（免密）
cd backend\file-drop
$env:FILE_DROP_PORT=7864
& "D:\codex\抖音视频下载\.venv\Scripts\python.exe" app.py
```

浏览器打开 http://127.0.0.1:5173/#/tools ，进入「随手存」「文件小站」。工具服务没启动时页面会显示「服务暂时连不上」。
