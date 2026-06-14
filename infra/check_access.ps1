<#
.SYNOPSIS
  Step 0, automated. Checks whether your machine + Azure account are ready for
  the live Foundry IQ integration, and prints exactly what to fix. Read-only —
  it creates nothing.

.EXAMPLE
  ./infra/check_access.ps1
#>
$ErrorActionPreference = "Continue"

$pass = @(); $todo = @()
function Ok($m)   { Write-Host "  [ OK ] $m" -ForegroundColor Green; $script:pass += $m }
function Todo($m) { Write-Host "  [TODO] $m" -ForegroundColor Yellow; $script:todo += $m }
function Has($n)  { [bool](Get-Command $n -ErrorAction SilentlyContinue) }

Write-Host "`n=== Crosscheck — Foundry IQ access check ===`n" -ForegroundColor Cyan

# 1. Python (standard, not free-threaded)
Write-Host "Python"
if (Has py) {
  $ft = & py -3.13 -c "import sys; print(not sys._is_gil_enabled() if hasattr(sys,'_is_gil_enabled') else False)" 2>$null
  if ($ft -eq "True") { Todo "Default 3.13 is free-threaded; use 'py -3.13' only after confirming a standard build, or install standard Python 3.12/3.13." }
  else { Ok "Standard Python available via 'py -3.13'." }
} else { Todo "Python launcher 'py' not found — install Python 3.12/3.13." }

# 2. Azure CLI + login
Write-Host "`nAzure CLI"
if (Has az) {
  Ok "Azure CLI installed."
  $acct = az account show --output json 2>$null | ConvertFrom-Json
  if ($acct) {
    Ok "Logged in — subscription '$($acct.name)' ($($acct.id))."
    # 3. Resource providers needed for Search + Azure OpenAI
    Write-Host "`nResource providers"
    foreach ($rp in @("Microsoft.Search", "Microsoft.CognitiveServices")) {
      $state = az provider show --namespace $rp --query registrationState --output tsv 2>$null
      if ($state -eq "Registered") { Ok "$rp registered." }
      else { Todo "$rp not registered — run: az provider register --namespace $rp" }
    }
  } else {
    Todo "Not logged in — run: az login"
  }
} else {
  Todo "Azure CLI missing — run: winget install -e --id Microsoft.AzureCLI  (then restart shell, az login)"
}

# 4. GitHub Copilot (optional coding assist)
Write-Host "`nGitHub Copilot (optional)"
if (Has gh) { Ok "GitHub CLI present (gh). Copilot extension: gh extension install github/gh-copilot" }
else { Todo "GitHub CLI missing (optional)." }

# Summary
Write-Host "`n=== Summary ===" -ForegroundColor Cyan
Write-Host "  Ready:  $($pass.Count)" -ForegroundColor Green
Write-Host "  To do:  $($todo.Count)" -ForegroundColor Yellow
Write-Host ""
if ($todo.Count -eq 0) {
  Write-Host "All set. Next: ./infra/setup_foundry_iq.ps1  (provisions resources + uploads the corpus)" -ForegroundColor Green
} else {
  Write-Host "Fix the [TODO] items above, then re-run this script." -ForegroundColor Yellow
  Write-Host "Note: an EMPTY Azure account is fine — setup_foundry_iq.ps1 brings the data (uploads corpus/)." -ForegroundColor Gray
}
Write-Host ""
