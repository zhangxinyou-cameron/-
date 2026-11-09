param([switch]$ConfigureOnly)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $repoRoot
try {
    $giteeUrl = 'https://gitee.com/zhang-xinyou/wisdom-cultivator.git'
    $githubUrl = 'https://github.com/zhangxinyou-cameron/-.git'
    $remotes = @(git remote)
    if ($remotes -notcontains 'origin') {
        git remote add origin $giteeUrl
        if ($LASTEXITCODE -ne 0) { throw 'Cannot add origin.' }
    }
    if ($remotes -notcontains 'github') {
        git remote add github $githubUrl
        if ($LASTEXITCODE -ne 0) { throw 'Cannot add GitHub remote.' }
    }
    git config --local --replace-all remote.origin.pushurl $giteeUrl
    if ($LASTEXITCODE -ne 0) { throw 'Cannot configure Gitee push URL.' }
    git config --local --add remote.origin.pushurl $githubUrl
    if ($LASTEXITCODE -ne 0) { throw 'Cannot configure GitHub push URL.' }
    # Both default branch names resolve to the same commit on both platforms.
    git config --local --replace-all remote.origin.push 'HEAD:refs/heads/master'
    if ($LASTEXITCODE -ne 0) { throw 'Cannot configure master refspec.' }
    git config --local --add remote.origin.push 'HEAD:refs/heads/main'
    if ($LASTEXITCODE -ne 0) { throw 'Cannot configure main refspec.' }
    if ($ConfigureOnly) {
        Write-Output 'Configured: git push now updates Gitee and GitHub (main/master).'
        return
    }
    git push origin
    if ($LASTEXITCODE -ne 0) { throw 'Push incomplete. Check both remotes; resolve authentication or divergence and retry. No force push was used.' }
    $head = (git rev-parse HEAD).Trim()
    foreach ($url in @($giteeUrl, $githubUrl)) {
        $refs = @(git ls-remote --heads $url main master)
        if ($LASTEXITCODE -ne 0) { throw "Cannot verify remote: $url" }
        foreach ($branchName in @('main', 'master')) {
            $expected = '^' + $head + '\s+refs/heads/' + $branchName + '$'
            if (-not ($refs -match $expected)) { throw "Remote commit mismatch: $url / $branchName" }
        }
    }
    Write-Output "Both repositories verified at $head"
} finally {
    Pop-Location
}
