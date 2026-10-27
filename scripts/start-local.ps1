$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path -LiteralPath '.env')) { throw '请先配置 .env，参见 README.md。' }
if (-not (Test-Path -LiteralPath 'node_modules')) { throw '请先运行 npm ci。' }
npx prisma migrate deploy
if ($LASTEXITCODE -ne 0) { throw '数据库迁移失败，请检查 DATABASE_URL 和文件权限。' }
npm run build
if ($LASTEXITCODE -ne 0) { throw '前端构建失败。' }
Write-Host '启动 http://127.0.0.1:3070/ ，保持此窗口打开。'
npm start
