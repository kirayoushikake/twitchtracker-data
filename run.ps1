param(
  [Parameter(Position=0)][string]$Url,
  [string]$InputJson,
  [string]$OutputDir = (Join-Path $PSScriptRoot 'output'),
  [ValidateSet(0,30,90,180)][int]$Days = 30,
  [string]$CdpUrl,
  [switch]$Headed,
  [switch]$Quick
)
$ErrorActionPreference='Stop'
$node=Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
if(!(Test-Path $node)){ throw "Bundled Node.js not found: $node" }
$args=@((Join-Path $PSScriptRoot 'src\cli.mjs'),'--out-dir',$OutputDir)
if($InputJson){$args+=@('--input-json',$InputJson)}elseif($Url){$args+=$Url}else{throw '请提供 TwitchTracker URL 或 -InputJson。'}
if($Headed){$args+='--headed'};if($Quick){$args+='--quick'}
$args+=@('--days',$Days)
if($CdpUrl){$args+=@('--cdp-url',$CdpUrl)}
& $node @args; if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
