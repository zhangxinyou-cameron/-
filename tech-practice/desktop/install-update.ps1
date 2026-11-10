param([Parameter(Mandatory=$true)][string]$PlanFile)
$ErrorActionPreference='Stop'
$plan=Get-Content -LiteralPath $PlanFile -Raw -Encoding UTF8 | ConvertFrom-Json
$target=[IO.Path]::GetFullPath($plan.target)
$stage=[IO.Path]::GetFullPath($plan.stage)
$backup=[IO.Path]::GetFullPath($plan.backup)
$parent=[IO.Path]::GetDirectoryName($target)
if ($target -eq [IO.Path]::GetPathRoot($target) -or [IO.Path]::GetDirectoryName($stage) -ne $parent -or [IO.Path]::GetDirectoryName($backup) -ne $parent) { throw 'Invalid update paths' }
if ([IO.Path]::GetFileName($stage) -notmatch '^\.wisdom-update-[0-9a-f-]+$' -or [IO.Path]::GetFileName($backup) -notmatch '^\.wisdom-backup-[0-9a-f-]+$') { throw 'Invalid update directories' }
foreach ($folder in @($target,$stage)) {
 if ((Get-Item -LiteralPath $folder).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Update directory cannot be a link' }
 if (!(Test-Path -LiteralPath (Join-Path $folder 'TechPractice.exe')) -or !(Test-Path -LiteralPath (Join-Path $folder 'resources\app\package.json'))) { throw 'Incomplete application' }
}
if (Test-Path -LiteralPath $backup) { throw 'Backup already exists' }
try {
 $owner=Get-Process -Id $plan.parentPid -ErrorAction SilentlyContinue
 if ($owner) { if (!$owner.WaitForExit(90000)) { throw 'Application did not exit' } }
 $moved=$false
 for ($attempt=0;$attempt -lt 60;$attempt++) {
  try { Move-Item -LiteralPath $target -Destination $backup; $moved=$true; break } catch { Start-Sleep -Milliseconds 500 }
 }
 if (!$moved) { throw 'Application files are still in use' }
 try { Move-Item -LiteralPath $stage -Destination $target } catch { Move-Item -LiteralPath $backup -Destination $target; throw }
 Start-Process -FilePath (Join-Path $target 'TechPractice.exe') -WorkingDirectory $target -WindowStyle Hidden
 @{status='installed';message='Update installed';backup=$backup} | ConvertTo-Json | Set-Content -LiteralPath ($PlanFile+'.result.json') -Encoding UTF8
} catch {
 if ((Test-Path -LiteralPath $backup) -and (Test-Path -LiteralPath $target) -and !(Test-Path -LiteralPath $stage)) {
  Move-Item -LiteralPath $target -Destination $stage
  Move-Item -LiteralPath $backup -Destination $target
 }
 @{status='error';message=$_.Exception.Message} | ConvertTo-Json | Set-Content -LiteralPath ($PlanFile+'.result.json') -Encoding UTF8
 if (Test-Path -LiteralPath (Join-Path $target 'TechPractice.exe')) { Start-Process -FilePath (Join-Path $target 'TechPractice.exe') -WorkingDirectory $target -WindowStyle Hidden }
}
