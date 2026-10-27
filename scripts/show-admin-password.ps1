$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$taskCredentialPath = Join-Path (Get-Location) 'data\admin-access.json'
if (-not (Test-Path -LiteralPath $taskCredentialPath)) { throw '未找到加密的本机初始凭据。' }
$taskCredential = Get-Content -Raw -LiteralPath $taskCredentialPath | ConvertFrom-Json
$taskSecure = ConvertTo-SecureString $taskCredential.encryptedPassword
$taskPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskSecure)
try {
  Write-Host "用户名: $($taskCredential.username)"
  Write-Host ('密码: ' + [Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskPointer))
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskPointer)
}
