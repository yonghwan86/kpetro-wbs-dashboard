$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$venvPath = Join-Path $projectRoot '.venv'
$venvPython = Join-Path $venvPath 'Scripts\python.exe'

Set-Location $projectRoot

if (Get-Command py -ErrorAction SilentlyContinue) {
    & py -3 -m venv $venvPath
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
    & python -m venv $venvPath
} else {
    throw 'Python 3.11 이상을 먼저 설치해주세요.'
}

& $venvPython -m pip install --upgrade pip
& $venvPython -m pip install -r (Join-Path $projectRoot 'requirements.txt')

$envPath = Join-Path $projectRoot '.env'
if (-not (Test-Path -LiteralPath $envPath)) {
    Copy-Item -LiteralPath (Join-Path $projectRoot '.env.example') -Destination $envPath
    Write-Host '.env 파일을 생성했습니다. MariaDB 접속정보를 확인해주세요.' -ForegroundColor Yellow
}

Write-Host '개발환경 준비가 완료되었습니다.' -ForegroundColor Green
Write-Host '다음 명령: .\scripts\run-flask.ps1'
