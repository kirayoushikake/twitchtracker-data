param(
  [string[]]$Channels = @('sayu','dinah','lucypyre'),
  [string]$OutputDir = 'output/year-2026-09-22'
)
$ErrorActionPreference = 'Stop'
$runtime = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
if (!(Test-Path -LiteralPath $runtime)) { throw '需要安装项目 README 中说明的 artifact-tool 运行环境。' }
Push-Location $PSScriptRoot
$previousBatchDir = $env:TWITCHTRACKER_BATCH_DIR
try {
  $env:TWITCHTRACKER_BATCH_DIR = if ([System.IO.Path]::IsPathRooted($OutputDir)) { $OutputDir } else { Join-Path $PSScriptRoot $OutputDir }
  & $runtime src/collect-year.mjs @Channels
  if ($LASTEXITCODE -ne 0) { throw '采集失败，已保存的数据可续采。' }
  & $runtime src/prepare-year.mjs
  if ($LASTEXITCODE -ne 0) { throw '数据整理失败。' }
  & $runtime src/retry-year.mjs @Channels
  if ($LASTEXITCODE -ne 0) { throw '补采失败。' }
  & $runtime src/prepare-year.mjs
  if ($LASTEXITCODE -ne 0) { throw '补采后数据整理失败。' }
  & $runtime src/verify-year.mjs @Channels
  if ($LASTEXITCODE -ne 0) { throw '覆盖或数据校验未通过。' }
  & $runtime --max-old-space-size=8192 src/export-year.mjs @Channels
  if ($LASTEXITCODE -ne 0) { throw '导出未完成，请查看场次失败清单。' }
} finally { $env:TWITCHTRACKER_BATCH_DIR = $previousBatchDir; Pop-Location }
