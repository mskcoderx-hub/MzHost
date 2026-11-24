$scriptPath = Join-Path $PSScriptRoot 'vps.py'
$source = [IO.File]::ReadAllText($scriptPath).Replace("`r`n", "`n")
$encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($source))
# Keep each input line below the Linux terminal's canonical input limit.
$lines = [regex]::Matches($encoded, '.{1,100}') | ForEach-Object { $_.Value }
$install = @(
    'mkdir -p "$HOME/mzhost-worker" && cd "$HOME/mzhost-worker" && base64 -d > vps.py.tmp <<''MZHOST_WORKER'''
    $lines
    'MZHOST_WORKER'
    'if [ "$?" = 0 ]; then mv vps.py.tmp vps.py && python3 vps.py --smoke; fi'
) -join "`n"
Set-Clipboard -Value $install
Write-Output 'Paste into your VPS shell and press Enter. The installer runs the Python and Node smoke tests.'
