$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$tmp = Join-Path $root '.edge-tmp'
if (-not (Test-Path $tmp)) { New-Item -ItemType Directory -Path $tmp | Out-Null }
$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$url = 'file:///F:/%E6%A1%8C%E9%9D%A2/%E8%9E%8D%E9%85%92/index.html'
$dom = Join-Path $tmp 'dom.html'
$err = Join-Path $tmp 'err.txt'
$argList = @('--headless=new','--disable-gpu','--no-first-run',"--user-data-dir=$tmp\profile2",'--virtual-time-budget=8000','--dump-dom',$url)
$p = Start-Process -FilePath $edge -ArgumentList $argList -NoNewWindow -Wait -PassThru -RedirectStandardOutput $dom -RedirectStandardError $err
Write-Output "exit=$($p.ExitCode)"
Write-Output "dom=$((Get-Item $dom).Length) err=$((Get-Item $err).Length)"
