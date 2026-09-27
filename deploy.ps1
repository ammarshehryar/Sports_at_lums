<#
.SYNOPSIS
    Deploys sports-bracket-engine by committing and pushing to GitHub, which
    triggers the existing .github/workflows/deploy.yml Pages build/deploy.

.DESCRIPTION
    This project deploys via GitHub Actions on every push to `main` (see
    .github/workflows/deploy.yml) - Actions runs `npm run build` and
    publishes `dist/` to GitHub Pages. This script does NOT deploy on its
    own; it verifies the app builds cleanly on your machine first (so a
    broken push doesn't fail CI silently), then commits and pushes so
    Actions can take over.

.PARAMETER Message
    Commit message. Defaults to a timestamped "Deploy: <date>".

.PARAMETER Branch
    Branch to push (must match the workflow's trigger branch). Default: main.

.PARAMETER SkipInstall
    Skip `npm install`/`npm ci` (use if node_modules is already up to date).

.PARAMETER SkipBuild
    Skip the local build verification step. Not recommended - a failed
    build here means the GitHub Actions deploy will fail too, just later.

.PARAMETER DryRun
    Run every check (install, build) but stop before commit/push, so you
    can see what WOULD happen.

.EXAMPLE
    .\deploy.ps1
    .\deploy.ps1 -Message "Fix bracket round scheduling"
    .\deploy.ps1 -DryRun
#>

[CmdletBinding()]
param(
    [string]$Message = "Deploy: $(Get-Date -Format 'yyyy-MM-dd HH:mm')",
    [string]$Branch = 'main',
    [switch]$SkipInstall,
    [switch]$SkipBuild,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

function Write-Step  { param([string]$Text) Write-Host "`n==> $Text" -ForegroundColor Cyan }
function Write-Ok    { param([string]$Text) Write-Host "    $Text"   -ForegroundColor Green }
function Write-Info  { param([string]$Text) Write-Host "    $Text"   -ForegroundColor Gray }
function Write-WarnX { param([string]$Text) Write-Host "    $Text"   -ForegroundColor Yellow }

function Assert-LastExit {
    param([string]$FailureMessage)
    if ($LASTEXITCODE -ne 0) {
        throw "$FailureMessage (exit code $LASTEXITCODE)"
    }
}

# --- Always run from the script's own folder (the repo root) ---------------
$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $RepoRoot
Write-Step "Working in $RepoRoot"

try {
    # --- Sanity checks -------------------------------------------------
    Write-Step 'Checking required tools'
    foreach ($tool in 'git', 'npm') {
        if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
            throw "'$tool' was not found on PATH. Install it and try again."
        }
    }
    Write-Ok 'git and npm are available'

    git rev-parse --is-inside-work-tree *> $null
    Assert-LastExit 'This folder is not a git repository'

    $currentBranch = (git rev-parse --abbrev-ref HEAD).Trim()
    if ($currentBranch -ne $Branch) {
        Write-WarnX "You're on '$currentBranch', not the deploy branch '$Branch'."
        $answer = Read-Host "    Continue anyway and push '$currentBranch' as-is? (y/N)"
        if ($answer -notmatch '^[Yy]') {
            Write-Info 'Aborted.'
            exit 0
        }
        $Branch = $currentBranch
    } else {
        Write-Ok "On branch '$Branch'"
    }

    # --- Install dependencies ------------------------------------------
    if (-not $SkipInstall) {
        Write-Step 'Installing dependencies'
        if (Test-Path 'package-lock.json') {
            npm ci
        } else {
            npm install
        }
        Assert-LastExit 'npm install failed'
        Write-Ok 'Dependencies installed'
    } else {
        Write-Step 'Skipping dependency install (-SkipInstall)'
    }

    # --- Lint (non-blocking - warnings only) ----------------------------
    Write-Step 'Running lint'
    npm run lint
    if ($LASTEXITCODE -ne 0) {
        Write-WarnX 'Lint reported issues (continuing anyway - fix when convenient).'
    } else {
        Write-Ok 'Lint clean'
    }

    # --- Local build verification ---------------------------------------
    if (-not $SkipBuild) {
        Write-Step 'Building locally (verification only - CI does the real build)'
        npm run build
        Assert-LastExit 'Local build failed - fix the error above before deploying'
        Write-Ok 'Build succeeded'
    } else {
        Write-WarnX 'Skipping local build verification (-SkipBuild) - not recommended'
    }

    # --- Commit ----------------------------------------------------------
    Write-Step 'Checking for changes to commit'
    $status = git status --porcelain
    if ($status) {
        Write-Info "Changes detected:`n$status"
        if ($DryRun) {
            Write-WarnX "[DryRun] Would run: git add -A; git commit -m `"$Message`""
        } else {
            git add -A
            Assert-LastExit 'git add failed'
            git commit -m $Message
            Assert-LastExit 'git commit failed'
            Write-Ok "Committed: $Message"
        }
    } else {
        Write-Info 'No uncommitted changes - will still push in case you have local commits pending.'
    }

    # --- Push --------------------------------------------------------------
    Write-Step "Pushing to origin/$Branch"
    if ($DryRun) {
        Write-WarnX "[DryRun] Would run: git push origin $Branch"
        Write-Info 'Dry run complete - nothing was pushed.'
        exit 0
    }

    git push origin $Branch
    Assert-LastExit 'git push failed'
    Write-Ok 'Pushed successfully'

    # --- Report where to watch it deploy ------------------------------------
    Write-Step 'Deployment triggered'
    $remoteUrl = (git remote get-url origin).Trim()
    $owner = $null
    $repo  = $null
    if ($remoteUrl -match 'github\.com[:/]([^/]+)/(.+?)(?:\.git)?$') {
        $owner = $Matches[1]
        $repo  = $Matches[2]
    }

    if ($owner -and $repo) {
        Write-Ok "GitHub Actions run: https://github.com/$owner/$repo/actions"
        if ($repo -eq "$owner.github.io") {
            Write-Ok "Site (once the workflow finishes): https://$owner.github.io/"
        } else {
            Write-Ok "Site (once the workflow finishes): https://$owner.github.io/$repo/"
        }
    } else {
        Write-Info "Pushed to $remoteUrl - check your GitHub Actions tab for the deploy run."
    }
}
catch {
    Write-Host "`nDeploy aborted: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
