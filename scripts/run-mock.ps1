$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$mockRoot = Join-Path $projectRoot 'mock-site'
$venvPython = Join-Path $projectRoot '.venv\Scripts\python.exe'

Set-Location $mockRoot
Write-Host '목업 주소: http://127.0.0.1:8765' -ForegroundColor Green

if (Test-Path -LiteralPath $venvPython) {
    & $venvPython -m http.server 8765 --bind 127.0.0.1
} elseif (Get-Command py -ErrorAction SilentlyContinue) {
    & py -3 -m http.server 8765 --bind 127.0.0.1
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
    & python -m http.server 8765 --bind 127.0.0.1
} else {
    throw 'Python 3.11 이상을 설치하거나 VS Code Live Server로 mock-site를 열어주세요.'
}
