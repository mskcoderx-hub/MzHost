$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath '.vercel/project.json')) { throw 'Run vercel link in the MzHost project first.' }
$project = Get-Content -Raw -LiteralPath '.vercel/project.json' | ConvertFrom-Json
Write-Host "Configuring the production admin for $($project.projectName) ($($project.projectId))."
$name = (Read-Host 'Admin username').Trim()
if (-not $name) { throw 'Enter an admin username.' }
$credential = Get-Credential -UserName $name -Message 'Enter a new MzHost admin password (at least 16 characters). Save it in your password manager.'
if (-not $credential -or $credential.Password.Length -lt 16) { throw 'A password of at least 16 characters is required.' }
$plain = $credential.GetNetworkCredential().Password
$env:MZ_ADMIN_INPUT = $plain
try {
  $hash = node -e "const c=require('node:crypto'),s=c.randomBytes(16).toString('hex'); console.log(s+'$'+c.scryptSync(process.env.MZ_ADMIN_INPUT,s,64).toString('hex'))"
  if ($LASTEXITCODE -ne 0) { throw 'Could not hash the password.' }
} finally { Remove-Item Env:MZ_ADMIN_INPUT; $plain = $null }
$record = @{username=$credential.UserName; hash=$hash.Trim()} | ConvertTo-Json -Compress
$record | vercel env add ADMIN_CREDENTIALS production --sensitive --force
if ($LASTEXITCODE -ne 0) { throw 'Vercel did not save the admin credentials.' }
Write-Host 'Production credentials saved. Redeploy MzHost to activate them.'
