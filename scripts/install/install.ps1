# Opens desktop setup on a graphical computer; -Server installs the daemon, CLI and Node without administrator access.
#
#   irm https://colonia.ingenierobinario.com/install.ps1 | iex
#   .\install.ps1 -File colonia-core-2.2.0-win-x64.tar.gz      # a bundle you already have (no download)
#
# Parameters: -File <bundle>  -Version <x.y.z>  -Feed <owner/repo | http(s) URL>  -NoService  -Portable  -Uninstall
#             -Equipo <url> -Huella <fingerprint>  (this laptop as an equipo of another Colonia: the command Colonia shows you;
#             the 6-digit code is asked here and confirmed on this laptop, and an entry appears in Installed apps)
# A feed URL is a GitHub-shaped test feed (scripts/install/feed.ts): <url>/releases and <url>/download/v<x.y.z>/<file>.
# It lands in %USERPROFILE%\.colonia\v2\app (COLONIA_APP to change it); your data stays in %USERPROFILE%\.colonia\v2, and Colonia v1's
# files in %USERPROFILE%\.colonia are never touched. If Colonia v1 is installed, its daemon is stopped and its `colonia` removed.
# -NoService installs no login service; one already installed is left as it is (colonia service uninstall removes it).
# -Portable touches nothing outside that folder: no PATH entry, no login service, an earlier Colonia left alone.
# Keep this file ASCII: Windows PowerShell 5.1 reads a script without a byte order mark in the system's code page.
param(
  [string]$File = "",
  [string]$Version = "",
  [string]$Feed = $(if ($env:COLONIA_RELEASES) { $env:COLONIA_RELEASES } else { "ingenierobinario/colonia" }),
  [switch]$NoService,
  [switch]$Server,
  [switch]$Desktop,
  [switch]$Portable,
  [switch]$Uninstall,
  [string]$Equipo = "",
  [string]$Huella = ""
)
# Under `irm | iex` this text runs in the user's own session: an `exit` would close their window, and a preference or
# a function set here would stay with them. So all of it runs in a block of its own, and a failure is thrown.
try {
  & {
    $ErrorActionPreference = "Stop"
    $ProgressPreference = "SilentlyContinue"

    function Say($m) { Write-Host "==> $m" -ForegroundColor Cyan }
    function Warn($m) { Write-Host "warning: $m" -ForegroundColor Yellow }
    function Die($m) { throw "$m" }
    # A program's stderr, once redirected, is a terminating error for Windows PowerShell 5.1 while errors stop.
    function Quiet([scriptblock]$run) { $ErrorActionPreference = "Continue"; & $run 2>$null }

    $App = if ($env:COLONIA_APP) { $env:COLONIA_APP } else { Join-Path $env:USERPROFILE ".colonia\v2\app" }
    $Arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
    $Bin = Join-Path $App "bin"
    if ($Portable) { $Server = $true; $NoService = $true }
    # Pairing needs the daemon (it holds the connection): server mode with the service, never portable.
    if ($Equipo -or $Huella) {
      if (-not ($Equipo -and $Huella)) { Die "-Equipo and -Huella go together: copy the whole command from Colonia" }
      if ($Portable -or $NoService -or $Desktop) { Die "-Equipo needs the service: do not combine it with -Portable, -NoService or -Desktop" }
      $Server = $true
    }
    $UninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ColoniaEquipo"

    # -Uninstall: the login entry and the program go; the data in .colonia\v2 stays (delete it yourself to start over).
    if ($Uninstall) {
      $cmd = Join-Path $Bin "colonia.cmd"
      # An equipo tells its Colonia and deletes its key before anything goes, so nothing stays authorised.
      if ((Test-Path -LiteralPath $UninstallKey) -and (Test-Path -LiteralPath $cmd)) {
        Say "Disconnecting this laptop from its Colonia"
        $env:COLONIA_APP = $App
        Quiet { & $cmd equipo desconectar } | Out-Null
      }
      Remove-Item -Path $UninstallKey -Recurse -ErrorAction SilentlyContinue
      if ((Test-Path -LiteralPath $cmd) -and -not $Portable) {
        Say "Stopping the Colonia daemon"
        $env:COLONIA_APP = $App
        & $cmd service uninstall
      }
      if (Test-Path -LiteralPath (Join-Path $App "current")) { (Get-Item -LiteralPath (Join-Path $App "current")).Delete() }
      Remove-Item -Recurse -Force -LiteralPath $App -ErrorAction SilentlyContinue
      if (-not $Portable) {
        $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
        [Environment]::SetEnvironmentVariable("Path", (($userPath -split ";") | Where-Object { $_ -and $_ -ne $Bin }) -join ";", "User")
      }
      Say "Colonia is uninstalled. Your data is still in $(Join-Path $env:USERPROFILE '.colonia\v2')"
      return
    }

    $mode = "server"
    $previous = Join-Path $App "install-mode"
    $existingServer = (Test-Path -LiteralPath (Join-Path $App "current")) -and (-not (Test-Path -LiteralPath $previous) -or (Get-Content -LiteralPath $previous -Raw).Trim() -eq "server")
    if ($Server -and $Desktop) { Die "choose -Server or -Desktop" }
    if ($Desktop -and ($File -or $NoService)) { Die "-File and -NoService require server mode" }
    $graphical = [Environment]::UserInteractive -and -not $env:SSH_CONNECTION -and -not $env:SSH_TTY
    if ($Desktop -or (-not $Server -and -not $File -and -not $NoService -and -not $existingServer -and $graphical)) { $mode = "desktop" }
    if ($mode -eq "desktop" -and -not $graphical) { Die "desktop setup needs a local graphical session; use -Server" }
    Say "Install mode: $mode"

    $Tar = Join-Path $env:SystemRoot "System32\tar.exe"
    if (-not (Test-Path -LiteralPath $Tar)) { Die "tar.exe is missing (Windows 10 1803 or newer has it)" }
    # Windows PowerShell 5.1 on an older Windows 10 still offers TLS 1.0 first, which the release host refuses.
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

    $Work = Join-Path ([System.IO.Path]::GetTempPath()) ("colonia-install-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
    New-Item -ItemType Directory -Path $Work | Out-Null
    try {
      # 1. The bundle: the file given, or this platform's from the newest release (or the one asked for).
      if ($File) {
        # Literal paths throughout: a name like "bundle [1].tar.gz" is not a wildcard.
        if (-not (Test-Path -LiteralPath $File)) { Die "no such file: $File" }
        $Name = Split-Path $File -Leaf
        if ($Name -notmatch "^colonia-core-(\d+\.\d+\.\d+)-win-$Arch\.tar\.gz$") { Die "$Name is not a bundle for win-$Arch" }
        $Version = $Matches[1]
        Copy-Item -LiteralPath $File (Join-Path $Work $Name)
        if (Test-Path -LiteralPath "$File.sha256") { Copy-Item -LiteralPath "$File.sha256" (Join-Path $Work "$Name.sha256") }
      } else {
        $UrlFeed = $Feed -match '^https?://'
        $Api = if ($UrlFeed) { $Feed.TrimEnd("/") } else { "https://api.github.com/repos/$Feed" }
        if (-not $Version) {
          Say "Looking for the newest Colonia in $Feed"
          try {
            $releases = Invoke-RestMethod -Headers @{ "accept" = "application/vnd.github+json"; "user-agent" = "colonia-install" } `
              -Uri "$Api/releases?per_page=100"
          } catch { Die "could not read the releases of $Feed" }
          # The highest plain vX.Y.Z from 2 up, not the newest by date: a fix to an older line can come after a newer one.
          $tag = $releases | Where-Object { -not $_.draft -and -not $_.prerelease -and $_.tag_name -match '^v([2-9]\d*\.\d+\.\d+)$' } |
            Sort-Object { [version]$_.tag_name.Substring(1) } -Descending | Select-Object -First 1
          if (-not $tag) { Die "no Colonia release found in $Feed" }
          $Version = $tag.tag_name.Substring(1)
        }
        $Version = $Version.TrimStart("v")
        $Name = "colonia-core-$Version-win-$Arch.tar.gz"
        $Base = if ($UrlFeed) { "$Api/download/v$Version" } else { "https://github.com/$Feed/releases/download/v$Version" }
        Say "Downloading Colonia $Version (win-$Arch)"
        try { Invoke-WebRequest -UseBasicParsing -Uri "$Base/$Name" -OutFile (Join-Path $Work $Name) } catch { Die "could not download $Base/$Name" }
        try { Invoke-WebRequest -UseBasicParsing -Uri "$Base/$Name.sha256" -OutFile (Join-Path $Work "$Name.sha256") } catch { Die "could not download $Name.sha256" }
      }

      # 2. Checked against its .sha256 when there is one (always, for a download).
      $Bundle = Join-Path $Work $Name
      if (Test-Path -LiteralPath "$Bundle.sha256") {
        $want = ((Get-Content -LiteralPath "$Bundle.sha256" -Raw).Trim() -split "\s+")[0].ToLower()
        $got = (Get-FileHash -LiteralPath $Bundle -Algorithm SHA256).Hash.ToLower()
        if ($want -ne $got) { Die "$Name does not match its .sha256 (expected $want, got $got)" }
      } else {
        Warn "no $Name.sha256 beside the file: not checked"
      }

      # 3. Colonia v1 first: its daemon stops (two daemons would answer the same Telegram bots) and its `colonia` goes.
      if ($mode -eq "server" -and -not $Portable) {
        $runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
        if (Get-ItemProperty -Path $runKey -Name "ColoniaDaemon" -ErrorAction SilentlyContinue) {
          Say "Stopping an earlier Colonia's daemon"
          Remove-ItemProperty -Path $runKey -Name "ColoniaDaemon"
          Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
            Where-Object { $_.CommandLine -match "colonia[\\/]src[\\/]host[\\/]daemon" } |
            ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
        }
        if ((Get-Command npm -ErrorAction SilentlyContinue) -and (Quiet { npm ls -g --depth=0 @ingenierobinario/colonia } | Select-String "@ingenierobinario/colonia")) {
          Say "Removing an earlier colonia command (its files in .colonia stay, to import them)"
          Quiet { npm uninstall -g @ingenierobinario/colonia } | Out-Null
        }
      }

      # 4. A running Colonia daemon from an earlier install stops before its files are replaced. -NoService means
      # "install no service", not "remove the one there is": that one is left alone (step 7 says so).
      $current = Join-Path $App "current"
      if ($mode -eq "server" -and -not $NoService -and (Test-Path -LiteralPath (Join-Path $current "node\node.exe"))) {
        Quiet { & (Join-Path $current "node\node.exe") --disable-warning=ExperimentalWarning (Join-Path $current "apps\terminal\src\main.ts") service uninstall } | Out-Null
      }

      # 5. Unpacked beside any version already there, then made current (a junction).
      Say "Installing Colonia $Version in $App"
      $unpacked = Join-Path $Work "unpacked"
      New-Item -ItemType Directory -Path $unpacked | Out-Null
      & $Tar -xzf $Bundle -C $unpacked
      if ($LASTEXITCODE -ne 0) { Die "could not unpack $Name" }
      if (-not (Test-Path -LiteralPath (Join-Path $unpacked "colonia\node\node.exe"))) { Die "$Name has no Node inside" }
      # Only a server install is kept: over an earlier desktop install, `current` moves to this version like any other.
      if ($mode -eq "desktop" -and $existingServer) {
        Say "Installing desktop without replacing the existing server"
        $env:COLONIA_RELEASES = $Feed
        $env:COLONIA_INSTALL_VERSION = $Version
        try {
          & (Join-Path $unpacked "colonia\node\node.exe") --disable-warning=ExperimentalWarning (Join-Path $unpacked "colonia\apps\terminal\src\main.ts") desktop
        } finally { Remove-Item Env:COLONIA_INSTALL_VERSION -ErrorAction SilentlyContinue }
        if ($LASTEXITCODE -ne 0) { Die "desktop setup failed; retry: colonia desktop" }
        return
      }
      $versions = Join-Path $App "versions"
      New-Item -ItemType Directory -Force -Path $versions | Out-Null
      $target = Join-Path $versions $Version
      if (Test-Path -LiteralPath $target) {
        try { Remove-Item -Recurse -Force -LiteralPath $target }
        catch { Die "Colonia $Version is in use and cannot be replaced: close Colonia (colonia service stop) and run this again" }
      }
      $fresh = Join-Path $unpacked "colonia"
      # A folder cannot be moved to another drive, and the temporary folder may be on one.
      # PowerShell 5.1 reads -Destination as a pattern and a folder named with [ ] is "not found": .NET moves it as named.
      # An antivirus scanning the files just unpacked can hold one open for a moment, and the move is then refused:
      # it is tried again, and copied in the end.
      $moved = $false
      if ([System.IO.Path]::GetPathRoot($fresh) -ieq [System.IO.Path]::GetPathRoot($target)) {
        for ($try = 0; ($try -lt 5) -and -not $moved; $try++) {
          try { [System.IO.Directory]::Move($fresh, $target); $moved = $true } catch { Start-Sleep -Milliseconds 500 }
        }
      }
      if (-not $moved) { Copy-Item -Recurse -LiteralPath $fresh -Destination $target }
      # Removing a junction never touches what it points at.
      if (Test-Path -LiteralPath $current) { (Get-Item -LiteralPath $current).Delete() }
      # New-Item -ItemType Junction cannot find a -Target with [ ] in its path, escaped or not, on PowerShell 5.1.
      $linked = cmd /d /c mklink /J "`"$current`"" "`"$target`"" 2>&1
      if ($LASTEXITCODE -ne 0) { Die "could not link $current to $target`: $linked" }

      # 6. The `colonia` command, always through `current`, on the user's PATH. It finds the program from its own
      # folder: a folder name with an accent written into the file would not survive the console's code page.
      New-Item -ItemType Directory -Force -Path $Bin | Out-Null
      @(
        '@echo off',
        'rem The Colonia command, written by install.ps1.',
        'if not defined COLONIA_APP for %%I in ("%~dp0..") do set "COLONIA_APP=%%~fI"',
        '"%COLONIA_APP%\current\node\node.exe" --disable-warning=ExperimentalWarning "%COLONIA_APP%\current\apps\terminal\src\main.ts" %*'
      ) | Set-Content -Encoding ASCII -LiteralPath (Join-Path $Bin "colonia.cmd")
      # The same command as colonia2: it reaches this Colonia even where another colonia (v1's) comes first on the PATH.
      [System.IO.File]::Copy((Join-Path $Bin "colonia.cmd"), (Join-Path $Bin "colonia2.cmd"), $true)
      if (-not $Portable) {
        $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
        if (($userPath -split ";") -notcontains $Bin) {
          [Environment]::SetEnvironmentVariable("Path", (($userPath, $Bin) | Where-Object { $_ }) -join ";", "User")
          Warn "added $Bin to your PATH: open a new terminal to use colonia"
        }
        $env:Path = "$Bin;$env:Path"
        $env:COLONIA_APP = $App
      }
      Set-Content -LiteralPath $previous -Value $mode -Encoding ASCII
      if ($Feed -ne "ingenierobinario/colonia") { $env:COLONIA_RELEASES = $Feed }
      if ($mode -eq "desktop") {
        Say "Installing and opening Colonia desktop. Choose server or client in the app."
        $env:COLONIA_INSTALL_VERSION = $Version
        try { & (Join-Path $Bin "colonia.cmd") desktop } finally { Remove-Item Env:COLONIA_INSTALL_VERSION -ErrorAction SilentlyContinue }
        if ($LASTEXITCODE -ne 0) { Die "desktop setup failed; retry: colonia desktop" }
        return
      }

      # 7. The daemon at login, started again if it stops.
      if (-not $NoService) {
        # A feed other than the public one (a test feed, a mirror) is where this install keeps updating from.
        if ($Feed -ne "ingenierobinario/colonia") { $env:COLONIA_RELEASES = $Feed }
        Say "Starting the Colonia daemon"
        & (Join-Path $Bin "colonia.cmd") service install
        if ($LASTEXITCODE -ne 0) { Warn "the service did not install; run: colonia service install" }
      } elseif (-not $Portable) {
        # A login entry this install wrote runs a command under $App (service install, step 7).
        $runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
        $entry = (Get-Item -Path $runKey -ErrorAction SilentlyContinue).Property |
          Where-Object { "$((Get-ItemProperty -Path $runKey -Name $_).$_)".IndexOf("$App\", [StringComparison]::OrdinalIgnoreCase) -ge 0 } |
          Select-Object -First 1
        if ($entry) {
          Say "A Colonia service is already installed (login entry $entry): -NoService leaves it as it is; it runs this version from its next start (colonia service restart). To remove it: colonia service uninstall"
        }
      }

      if ($Equipo) {
        # Installed apps: a normal name and a normal uninstall (it disconnects first, then removes the program).
        New-Item -Path $UninstallKey -Force | Out-Null
        $self = Join-Path $App "uninstall-equipo.cmd"
        @('@echo off', 'powershell -NoProfile -ExecutionPolicy Bypass -Command "& ([scriptblock]::Create((irm https://colonia.ingenierobinario.com/install.ps1))) -Uninstall"') | Set-Content -Encoding ASCII -LiteralPath $self
        Set-ItemProperty -Path $UninstallKey -Name DisplayName -Value "Colonia (equipo)"
        Set-ItemProperty -Path $UninstallKey -Name DisplayVersion -Value $Version
        Set-ItemProperty -Path $UninstallKey -Name Publisher -Value "Colonia"
        Set-ItemProperty -Path $UninstallKey -Name UninstallString -Value "`"$self`""
        Set-ItemProperty -Path $UninstallKey -Name NoModify -Value 1 -Type DWord
        # The code is typed here, never passed in the command; the laptop's owner confirms it on this very machine.
        Say "Now confirm the code Colonia is showing"
        & (Join-Path $Bin "colonia.cmd") equipo emparejar $Equipo $Huella
        if ($LASTEXITCODE -ne 0) { Die "pairing did not complete; run it again from Colonia (Add a computer) or: colonia equipo emparejar" }
      }

      Say "Colonia $Version is installed. Try: colonia status"
      Write-Host "    To use it from another computer: colonia expose tailscale (or lan), then colonia pair"
    } finally {
      Remove-Item -Recurse -Force -LiteralPath $Work -ErrorAction SilentlyContinue
    }
  }
} catch {
  Write-Host "error: $($_.Exception.Message)" -ForegroundColor Red
  # A script file tells who ran it that it failed; text piped into a session has no process of its own to end.
  if ($PSCommandPath) { exit 1 }
  $global:LASTEXITCODE = 1
}
