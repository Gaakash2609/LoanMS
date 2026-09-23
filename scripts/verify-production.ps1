<#
  LoanMS / MudraHub - production authenticated verification
  ---------------------------------------------------------
  Runs the 7 authenticated checks against https://app.mudrahub.com that cannot
  be run without a real production login.

  USAGE
      pwsh -File scripts/verify-production.ps1
      pwsh -File scripts/verify-production.ps1 -SkipUpload      # skip check 5
      pwsh -File scripts/verify-production.ps1 -LoanId 123      # pin a loan

  It prompts for credentials with Read-Host -AsSecureString. Nothing is echoed,
  nothing is written to disk, and no password or token is ever printed - only
  HTTP status codes and PASS/FAIL. Read it before you run it.

  Check 5 uploads one small text file to an existing loan and deletes it again
  through the application's own delete endpoint. That is the only write it
  makes. Pass -SkipUpload to avoid touching production documents entirely.
#>

param(
  [string] $BaseUrl = "https://app.mudrahub.com",
  [int]    $LoanId  = 0,
  [int]    $CustomerId = 0,
  [switch] $SkipUpload
)

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ErrorActionPreference = "SilentlyContinue"

$script:Results = [ordered]@{}
function Record($name, $ok, $detail) {
  $script:Results[$name] = @{ ok = $ok; detail = $detail }
  $tag = if ($ok) { "PASS" } else { "FAIL" }
  Write-Host ("  [{0}] {1} - {2}" -f $tag, $name, $detail)
}

function Api($tok, $verb, $path, $body) {
  $h = @{ Authorization = "Bearer $tok" }
  try {
    if ($body) {
      $r = Invoke-WebRequest -Uri "$BaseUrl$path" -Method $verb -Headers $h `
             -Body ($body | ConvertTo-Json -Depth 8) -ContentType "application/json" `
             -UseBasicParsing -TimeoutSec 40
    } else {
      $r = Invoke-WebRequest -Uri "$BaseUrl$path" -Method $verb -Headers $h `
             -UseBasicParsing -TimeoutSec 40
    }
    return @{ code = $r.StatusCode; json = ($r.Content | ConvertFrom-Json); raw = $r }
  } catch {
    $c = 0; if ($_.Exception.Response) { $c = $_.Exception.Response.StatusCode.value__ }
    return @{ code = $c; err = $_.ErrorDetails.Message }
  }
}

function Login($label) {
  Write-Host ""
  Write-Host "Enter $label credentials (input is hidden, never printed or saved):"
  $email = Read-Host "  email"
  $sec   = Read-Host "  password" -AsSecureString
  $bstr  = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
  $payload = @{ email = $email; password = $plain } | ConvertTo-Json
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  Remove-Variable plain -ErrorAction SilentlyContinue
  try {
    $r = Invoke-WebRequest -Uri "$BaseUrl/api/auth/login" -Method POST -Body $payload `
           -ContentType "application/json" -UseBasicParsing -TimeoutSec 40
    $j = $r.Content | ConvertFrom-Json
    if ($j.success) { return $j.data }
    Write-Host "  login rejected: $($j.errors -join '; ')"
  } catch {
    Write-Host "  login request failed: HTTP $($_.Exception.Response.StatusCode.value__)"
  } finally { Remove-Variable payload -ErrorAction SilentlyContinue }
  return $null
}

Write-Host "=========================================================="
Write-Host " LoanMS production verification - $BaseUrl"
Write-Host "=========================================================="

# ---------------------------------------------------------------- 1. LOGIN
$admin = Login "an ADMIN"
if (-not $admin) { Write-Host "`nAborting: admin login failed."; exit 1 }
$T = $admin.accessToken

$me = Api $T "GET" "/api/auth/me" $null
Record "1. LOGIN" ($me.code -eq 200) "login ok, role=$($admin.user.role), /auth/me=$($me.code)"

$root = Invoke-WebRequest -Uri "$BaseUrl/" -UseBasicParsing -TimeoutSec 30
$isReact  = $root.Content -match '/assets/index-'
$isLegacy = $root.Content -match '/js/boot\.js'
Record "1b. REACT AT /" ($isReact -and -not $isLegacy) "len=$($root.Content.Length) react=$isReact legacy=$isLegacy"

# ---------------------------------------------------------- 2. LOAN DETAIL
$list = Api $T "GET" "/api/loans" $null
$items = if ($list.json.data.items) { $list.json.data.items } else { $list.json.data }
Record "2a. LOAN LIST" ($list.code -eq 200) "HTTP $($list.code), count=$($items.Count)"

if ($LoanId -eq 0 -and $items.Count -gt 0) { $LoanId = $items[0].id }
if ($LoanId -gt 0) {
  $d = Api $T "GET" "/api/loans/$LoanId" $null
  $refs = $d.json.data.references.Count
  Record "2b. LOAN DETAIL" ($d.code -eq 200) "loan $LoanId HTTP $($d.code), references=$refs, status=$($d.json.data.status)"
} else {
  Record "2b. LOAN DETAIL" $false "no loans available to open"
}

# --------------------------------------------------------------- 3. REPORTS
$sum = Api $T "GET" "/api/Reports/summary?scope=all" $null
$okSum = $sum.code -eq 200
Record "3. REPORTS SUMMARY" $okSum "HTTP $($sum.code)$(if(-not $okSum){' :: '+$sum.err})"
foreach ($ep in @("pipeline","performance","disbursement","monthly")) {
  $x = Api $T "GET" "/api/Reports/$ep" $null
  Record "3b. REPORTS/$ep" ($x.code -eq 200) "HTTP $($x.code)"
}

# ----------------------------------------------------------------- 4. CIBIL
if ($CustomerId -eq 0) {
  $cust = Api $T "GET" "/api/customers" $null
  $cItems = if ($cust.json.data.items) { $cust.json.data.items } else { $cust.json.data }
  if ($cItems.Count -gt 0) { $CustomerId = $cItems[0].id }
}
if ($CustomerId -gt 0) {
  $ph = Api $T "GET" "/api/Cibil/payment-history?customerId=$CustomerId" $null
  # 200 = report on file; 404 = no bureau report (correct). 500 = the bug.
  $okPh = ($ph.code -eq 200 -or $ph.code -eq 404)
  Record "4. CIBIL PAYMENT-HISTORY" $okPh "customer $CustomerId HTTP $($ph.code) (200 or 404 expected; 500 = regression)"
  foreach ($ep in @("risk-analysis","insights","accounts")) {
    $x = Api $T "GET" "/api/Cibil/$ep`?customerId=$CustomerId" $null
    Record "4b. CIBIL/$ep" ($x.code -eq 200 -or $x.code -eq 404) "HTTP $($x.code)"
  }
} else {
  Record "4. CIBIL PAYMENT-HISTORY" $false "no customers available"
}

# ------------------------------------------------------- 5. DOCUMENTS / S3
if ($SkipUpload) {
  Record "5. DOCUMENTS/S3" $false "SKIPPED (-SkipUpload)"
} elseif ($LoanId -gt 0) {
  $tmp = Join-Path $env:TEMP "loanms-verify-$(Get-Date -Format yyyyMMddHHmmss).txt"
  $marker = "loanms production verification $(Get-Date -Format o)"
  Set-Content -Path $tmp -Value $marker -Encoding ascii

  # multipart upload via .NET so we do not depend on curl
  Add-Type -AssemblyName System.Net.Http
  $client  = New-Object System.Net.Http.HttpClient
  $client.DefaultRequestHeaders.Authorization =
      New-Object System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", $T)
  $content = New-Object System.Net.Http.MultipartFormDataContent
  $fs      = [IO.File]::OpenRead($tmp)
  $fileC   = New-Object System.Net.Http.StreamContent($fs)
  $fileC.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse("text/plain")
  $content.Add($fileC, "file", [IO.Path]::GetFileName($tmp))
  $content.Add((New-Object System.Net.Http.StringContent("Verification")), "documentType")

  $up = $client.PostAsync("$BaseUrl/api/loans/$LoanId/documents", $content).Result
  $upBody = $up.Content.ReadAsStringAsync().Result
  $fs.Close()
  Record "5a. S3 UPLOAD" ($up.StatusCode.value__ -in 200,201) "HTTP $($up.StatusCode.value__)"

  $docs = Api $T "GET" "/api/loans/$LoanId/documents" $null
  $mine = @($docs.json.data | Where-Object { $_.fileName -like "*loanms-verify-*" })
  if ($mine.Count -gt 0) {
    $doc = $mine[0]
    try {
      $dl = Invoke-WebRequest -Uri "$BaseUrl/api/loans/$LoanId/documents/$($doc.fileName)" `
              -Headers @{ Authorization = "Bearer $T" } -UseBasicParsing -TimeoutSec 40
      $got = [Text.Encoding]::ASCII.GetString($dl.Content).Trim()
      Record "5b. S3 DOWNLOAD" ($dl.StatusCode -eq 200 -and $got -eq $marker) `
             "HTTP $($dl.StatusCode), content round-trip $(if($got -eq $marker){'MATCHES'}else{'DIFFERS'})"
    } catch {
      Record "5b. S3 DOWNLOAD" $false "HTTP $($_.Exception.Response.StatusCode.value__)"
    }
    $del = Api $T "DELETE" "/api/loans/$LoanId/documents/$($doc.id)" $null
    Record "5c. TEST DOC CLEANUP" ($del.code -in 200,204) "HTTP $($del.code) (app's own delete flow)"
  } else {
    Record "5b. S3 DOWNLOAD" $false "uploaded document not found in listing"
  }
  Remove-Item $tmp -ErrorAction SilentlyContinue
} else {
  Record "5. DOCUMENTS/S3" $false "no loan available"
}

# --------------------------------------------------- 6. PASSWORD RESET
$fp = @{ email = "no-such-user-verification@example.invalid" } | ConvertTo-Json
try {
  $r = Invoke-WebRequest -Uri "$BaseUrl/api/auth/forgot-password" -Method POST -Body $fp `
         -ContentType "application/json" -UseBasicParsing -TimeoutSec 40
  $j = $r.Content | ConvertFrom-Json
  $nonEnum = ($r.StatusCode -eq 200 -and $j.message -match "if an account")
  Record "6. PASSWORD RESET" $nonEnum "HTTP $($r.StatusCode), non-enumerating=$nonEnum"
  Write-Host "       NOTE: now trigger it for a real test account and confirm the"
  Write-Host "             emailed link starts with $BaseUrl/reset-password"
} catch {
  Record "6. PASSWORD RESET" $false "HTTP $($_.Exception.Response.StatusCode.value__)"
}

# ------------------------------------------------------------- 7. RBAC
Write-Host ""
Write-Host "Check 7 needs a NON-ADMIN account (Sales / Manager / Partner)."
$na = Login "a NON-ADMIN"
if ($na) {
  $nt = $na.accessToken
  Write-Host "  logged in as role=$($na.user.role)"
  $mustDeny = @("/api/Users","/api/Settings/ai-keys","/api/Audit","/api/Teams")
  $denied = 0
  foreach ($p in $mustDeny) {
    $x = Api $nt "GET" $p $null
    if ($x.code -eq 403 -or $x.code -eq 401) { $denied++ }
    Write-Host ("     {0,-28} -> {1}" -f $p, $x.code)
  }
  Record "7a. RBAC DENIES" ($denied -eq $mustDeny.Count) "$denied/$($mustDeny.Count) restricted endpoints returned 401/403"

  $allowed = 0
  foreach ($p in @("/api/Customers","/api/Loans")) {
    $x = Api $nt "GET" $p $null
    if ($x.code -eq 200) { $allowed++ }
    Write-Host ("     {0,-28} -> {1}" -f $p, $x.code)
  }
  Record "7b. RBAC ALLOWS" ($allowed -eq 2) "$allowed/2 permitted modules still work"
} else {
  Record "7. RBAC" $false "non-admin login not provided"
}

# ------------------------------------------------------------- SUMMARY
Write-Host ""
Write-Host "=========================== SUMMARY ==========================="
$pass = 0; $fail = 0
foreach ($k in $script:Results.Keys) {
  $v = $script:Results[$k]
  if ($v.ok) { $pass++ } else { $fail++ }
  Write-Host ("  {0,-26} {1}" -f $k, $(if ($v.ok) { "PASS" } else { "FAIL" }))
}
Write-Host "---------------------------------------------------------------"
Write-Host "  PASS: $pass   FAIL: $fail"
Write-Host "==============================================================="
