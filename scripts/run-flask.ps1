$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$venvPython = Join-Path $projectRoot '.venv\Scripts\python.exe'

if (-not (Test-Path -LiteralPath $venvPython)) {
    throw '가상환경이 없습니다. 먼저 .\scripts\setup-dev.ps1을 실행해주세요.'
}
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot '.env'))) {
    throw '.env가 없습니다. .env.example을 복사하고 DB 정보를 입력해주세요.'
}

Set-Location $projectRoot
& $venvPython server.py
