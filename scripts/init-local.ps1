$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$taskDataRoot=Join-Path $env:LOCALAPPDATA 'PersonalLifeSpace'
$taskDb=Join-Path $taskDataRoot 'data\space.db'
$taskUploads=Join-Path $taskDataRoot 'uploads'
if ((Test-Path -LiteralPath '.env') -or (Test-Path -LiteralPath $taskDb)) { throw '已存在 .env 或数据库文件，未覆盖。请按 README 检查现有配置。' }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $taskDb),$taskUploads,data | Out-Null
[IO.File]::WriteAllBytes($taskDb,[byte[]]@())
$taskSessionSecret = [Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLower()
$taskDbUrl='file:'+($taskDb.Replace('\','/'))
$taskEnv=@("DATABASE_URL=$taskDbUrl", "SESSION_SECRET=$taskSessionSecret", 'PORT=3070', 'NODE_ENV=development', "UPLOAD_DIR=$($taskUploads.Replace('\','/'))", 'PUBLIC_BASE_URL=http://127.0.0.1:3070', 'LEGACY_BASE_URL=http://127.0.0.1:7860')
[IO.File]::WriteAllLines((Join-Path (Get-Location) '.env'),$taskEnv,[Text.UTF8Encoding]::new($false))
npm ci --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw '依赖安装失败。' }
npx prisma generate
if ($LASTEXITCODE -ne 0) { throw 'Prisma 客户端生成失败。' }
npx prisma migrate deploy
if ($LASTEXITCODE -ne 0) { throw '数据库迁移失败。' }
npm run admin:create
if ($LASTEXITCODE -ne 0) { throw '管理员创建失败。' }
Write-Host '初始化完成。查看密码：powershell -ExecutionPolicy Bypass -File scripts\show-admin-password.ps1'
Write-Host '可选示例数据：npm run db:seed'
Write-Host '启动：powershell -ExecutionPolicy Bypass -File scripts\start-local.ps1'
