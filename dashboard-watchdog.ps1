# LLM-UI dashboard watchdog: starts server.py if port 8000 is not listening.
# Used by the "LLM-UI Dashboard Watchdog" scheduled task (every minute) and by
# a Startup-folder entry at logon.
$port = 8000
$listening = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if (-not $listening) {
  Start-Process -FilePath 'pythonw' -ArgumentList 'server.py' `
    -WorkingDirectory 'D:\_Agents\LLM-UI' -WindowStyle Hidden
}
