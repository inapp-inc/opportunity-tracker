<#Requires -Version 5.1
.SYNOPSIS
  Verifies/installs Node.js, Python (for native npm builds), npm project deps including React/
  react-dom under web/, installs Chrome when missing, then starts API + Vite and opens Chrome.

.NOTES
  Run from this folder via double-click: Start-OpportunityTracker.bat
  Closing the spawned "API" and "Web" console windows stops those servers.

.EXAMPLE
  powershell.exe -ExecutionPolicy Bypass -File .\Start-OpportunityTracker.ps1
#>
[CmdletBinding()]
param()

try {
    $ErrorActionPreference = 'Stop'

    $Root = $PSScriptRoot
    $ServerDir = Join-Path $Root 'server'
    $WebDir = Join-Path $Root 'web'

    $ApiPort = 3001
    $UiPort = 5173

    function Write-Step {
        param([string]$Message)
        Write-Host "`n>>> $Message" -ForegroundColor Cyan
    }

    function Refresh-PathFromMachineAndUser {
        $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
        $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
        $combined = @($machinePath, $userPath) | Where-Object { $_ }
        if ($combined.Count -gt 0) {
            $env:Path = ($combined -join ';')
        }
    }

    function Test-PortOpen {
        param([int]$Port, [int]$TimeoutMs = 750)
        $client = New-Object System.Net.Sockets.TcpClient
        try {
            # String host avoids Framework differences around Loopback enumeration
            $iar = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
            $okWait = $iar.AsyncWaitHandle.WaitOne($TimeoutMs, $false)
            if (-not $okWait) {
                try { $client.Close() } catch {}
                return $false
            }
            try {
                $client.EndConnect($iar)
                return $client.Connected
            }
            catch { return $false }
            finally { try { $client.Close() } catch {} }
        }
        catch { return $false }
        finally { try { $client.Dispose() } catch {} }
    }

    function Wait-TcpListening {
        param([int]$Port, [string]$Description, [int]$TimeoutSeconds = 120)
        Write-Host "Waiting for $Description on port $Port..." -ForegroundColor DarkGray
        $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
        while ((Get-Date) -lt $deadline) {
            if (Test-PortOpen -Port $Port) {
                Write-Host "  $Description is reachable." -ForegroundColor Green
                return $true
            }
            Start-Sleep -Milliseconds 500
        }
        Write-Warning "$Description did not become ready within ${TimeoutSeconds}s."
        return $false
    }

    function Get-ChromeExe {
        $candidates = @(
            (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
            (${env:ProgramFiles(x86)} + '\Google\Chrome\Application\chrome.exe'),
            (Join-Path $env:LocalAppData 'Google\Chrome\Application\chrome.exe')
        )
        foreach ($path in $candidates) {
            if ($path -and (Test-Path -LiteralPath $path)) {
                return (Resolve-Path -LiteralPath $path).Path
            }
        }
        $chromeCmd = Get-Command chrome.exe -ErrorAction SilentlyContinue
        if ($chromeCmd -and $chromeCmd.Source) { return $chromeCmd.Source }
        return $null
    }

    function Get-EdgeExe {
        $edge = Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'
        if (Test-Path -LiteralPath $edge) { return (Resolve-Path $edge).Path }
        return $null
    }

    function Ensure-WingetAvailable {
        $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
        if (-not $winget -or -not ($winget.Source)) {
            Write-Host 'ERROR: winget.exe was not found. Install Git for winget prerequisites, or Node.js manually from https://nodejs.org/' `
                -ForegroundColor Red
            exit 2
        }
        return $winget.Source
    }

    function Test-NodeAndNpmOk {
        try {
            $vStr = (& node.exe -v 2>$null)
            if (-not $vStr) { return $false }
            $vStr = $vStr.TrimStart('v')
            $ver = [version]$vStr
            if ($ver.Major -lt 18) { return $false }
            $null = & npm.cmd --version 2>$null
            return ($LASTEXITCODE -eq 0)
        }
        catch { return $false }
    }

    function Ensure-NodeInstalled {
        Refresh-PathFromMachineAndUser

        $nodeStd = Join-Path $env:ProgramFiles 'nodejs\node.exe'
        if ((-not (Test-NodeAndNpmOk)) -and (Test-Path -LiteralPath $nodeStd)) {
            $nodejsDir = Split-Path $nodeStd
            $env:Path = $nodejsDir + ';' + $env:Path
        }

        if (Test-NodeAndNpmOk) {
            Write-Host ('Found Node {0}, npm {1}' -f (node.exe -v), (npm.cmd -v).Trim()) -ForegroundColor Green
            return
        }

        Write-Step 'Node.js/npm not usable. Installing Node.js LTS via winget (elevated prompt possible).'

        Ensure-WingetAvailable | Out-Null
        $wingetExe = (Get-Command winget.exe -ErrorAction Stop).Source

        $p = Start-Process -FilePath $wingetExe -ArgumentList @(
            'install', 'OpenJS.NodeJS.LTS', '-e',
            '--accept-package-agreements', '--accept-source-agreements', '--silent'
        ) -PassThru -Wait -NoNewWindow

        Refresh-PathFromMachineAndUser

        if (Test-Path -LiteralPath $nodeStd) {
            $nodejsDir = Split-Path $nodeStd
            $env:Path = $nodejsDir + ';' + $env:Path
        }

        Start-Sleep -Seconds 2

        if (-not (Test-NodeAndNpmOk)) {
            Write-Host 'ERROR: Node/npm still unavailable after winget. Open a new terminal (PATH refresh) and run again.' -ForegroundColor Red
            exit 3
        }

        Write-Host ('Installed Node {0}, npm {1}' -f (node.exe -v), (npm.cmd -v).Trim()) -ForegroundColor Green
    }

    function Test-ExeAcceptsSysVersion {
        param([string]$ExePath)

        try {
            if (-not $ExePath -or -not (Test-Path -LiteralPath $ExePath)) { return $false }
            $pyCode = @'
import sys
raise SystemExit(0 if sys.version_info >= (3, 9) else 1)
'@
            $null = & $ExePath -c $pyCode 2>$null
            return ($LASTEXITCODE -eq 0)
        }
        catch {
            return $false
        }
    }

    function Test-Python3Ok {
        <#
          Node-gyp / native addons look for Python 3.9+ (python.exe or py launcher).
        #>

        Refresh-PathFromMachineAndUser | Out-Null

        foreach ($alias in @( 'python.exe', 'python3.exe')) {
            $cmdTry = Get-Command $alias -ErrorAction SilentlyContinue
            if ($cmdTry -and $cmdTry.Source -and (Test-ExeAcceptsSysVersion -ExePath $cmdTry.Source)) {
                return $true
            }
        }

        $storeRoot = Join-Path $env:LocalAppData 'Programs\Python'
        if (Test-Path -LiteralPath $storeRoot) {
            foreach ($verDir in @(Get-ChildItem -LiteralPath $storeRoot -Directory -ErrorAction SilentlyContinue)) {
                foreach ($candidate in @(
                        (Join-Path $verDir.FullName 'python.exe'),
                        (Join-Path $verDir.FullName 'Scripts\python.exe'))) {
                    if (Test-Path -LiteralPath $candidate) {
                        if (Test-ExeAcceptsSysVersion -ExePath $candidate) {
                            $parent = Split-Path -Parent $candidate
                            $scripts = Join-Path $parent 'Scripts'
                            $prepend = @( $parent, $scripts ) -join ';'
                            $env:Path = "$prepend;$env:Path"
                            return $true
                        }
                    }
                }
            }
        }

        $pyLauncherCmd = Get-Command py.exe -ErrorAction SilentlyContinue
        if ($pyLauncherCmd -and $pyLauncherCmd.Source) {
            try {
                $pyCode = @'
import sys
raise SystemExit(0 if sys.version_info >= (3, 9) else 1)
'@
                $null = & $pyLauncherCmd.Source '-3' -c $pyCode 2>$null
                if ($LASTEXITCODE -eq 0) {
                    return $true
                }
            }
            catch { }
        }

        return $false
    }

    function Ensure-PythonInstalled {
        Write-Host 'Checking Python 3…' -ForegroundColor DarkGray

        Refresh-PathFromMachineAndUser

        if (Test-Python3Ok) {
            Write-Host 'Python 3 is available on PATH for native npm builds.' -ForegroundColor Green
            return
        }

        Write-Step 'Python 3.9+ not found. Installing Python 3.12 via winget (helps better-sqlite3 / node-gyp).'

        Ensure-WingetAvailable | Out-Null
        $wingetExe = (Get-Command winget.exe -ErrorAction Stop).Source

        function Add-KnownPythonPathsToSession {
            $hints = @(
                (Join-Path $env:LocalAppData 'Programs\Python'),
                (Join-Path $env:ProgramFiles 'Python312')
            )

            foreach ($guess in $hints) {
                if (-not (Test-Path -LiteralPath $guess)) { continue }

                Get-ChildItem -LiteralPath $guess -Depth 6 -Filter 'python.exe' -File `
                    -ErrorAction SilentlyContinue |
                    Select-Object -First 24 |
                    ForEach-Object {
                        $binDir = Split-Path -Parent $_.FullName
                        $scriptsPeer = Join-Path $binDir 'Scripts'
                        if (Test-Path -LiteralPath $scriptsPeer) {
                            $segment = '{0};{1};' -f $binDir, $scriptsPeer
                        }
                        else {
                            $segment = '{0};' -f $binDir
                        }
                        $env:Path = $segment + $env:Path
                    }
            }

            Refresh-PathFromMachineAndUser
        }

        foreach ($pkg in @(
                'Python.Python.3.12',
                'Python.Python.3.11')) {
            $null = Start-Process -FilePath $wingetExe -ArgumentList @(
                'install', $pkg, '-e',
                '--accept-package-agreements', '--accept-source-agreements',
                '--silent'
            ) -PassThru -Wait -NoNewWindow

            Refresh-PathFromMachineAndUser
            Start-Sleep -Seconds 4
            Add-KnownPythonPathsToSession | Out-Null

            if (Test-Python3Ok) {
                Write-Host ('Python verified after winget ({0}).' -f $pkg) -ForegroundColor Green
                return
            }
        }

        Write-Warning 'Python could not be confirmed after winget. If npm fails on native modules (e.g. better-sqlite3), install Python 3 manually and ensure it is on PATH, then re-run.'
    }

    function Ensure-WebReactDependencies {
        param([string]$WebDirectory)

        Write-Host 'Checking React (npm packages under web/)…' -ForegroundColor DarkGray

        $reactManifest = Join-Path $WebDirectory 'node_modules\react\package.json'
        $reactDomManifest = Join-Path $WebDirectory 'node_modules\react-dom\package.json'

        if ((Test-Path -LiteralPath $reactManifest) -and (Test-Path -LiteralPath $reactDomManifest)) {
            Write-Host 'React and react-dom are installed in web/node_modules.' -ForegroundColor Green
            return
        }

        $pkgPath = Join-Path $WebDirectory 'package.json'
        if (-not (Test-Path -LiteralPath $pkgPath)) {
            throw "Missing package.json in $WebDirectory"
        }

        Write-Step 'React / react-dom missing or incomplete — installing npm dependencies from package.json…'

        $raw = Get-Content -LiteralPath $pkgPath -Encoding UTF8 -Raw
        $pj = $raw | ConvertFrom-Json

        $reactVer = $pj.dependencies.react
        $reactDomVer = $pj.dependencies.'react-dom'

        Push-Location $WebDirectory
        try {
            if ($reactVer -and $reactDomVer) {
                npm.cmd install @(
                    "--no-fund",
                    "--no-audit",
                    "--loglevel", "error",
                    "react@${reactVer}",
                    "react-dom@${reactDomVer}"
                )
                if ($LASTEXITCODE -ne 0) { throw "npm install react failed (exit $LASTEXITCODE)" }
            }
            else {
                npm.cmd install --no-fund --no-audit --loglevel error
                if ($LASTEXITCODE -ne 0) { throw "npm install web failed (exit $LASTEXITCODE)" }
            }
        }
        finally {
            Pop-Location
        }

        if (-not ((Test-Path -LiteralPath $reactManifest) -and (Test-Path -LiteralPath $reactDomManifest))) {
            Write-Warning 'React packages still absent after npm install — try deleting web/node_modules and re-run launcher.'
        }
        else {
            Write-Host 'React and react-dom are now installed.' -ForegroundColor Green
        }
    }

    function Ensure-ChromeInstalled {
        $chromeBefore = Get-ChromeExe
        if ($chromeBefore) {
            Write-Host "Chrome available at $chromeBefore" -ForegroundColor Green
            return
        }

        Write-Step 'Chrome not installed. Installing Google Chrome via winget…'

        try {
            $wingetExe = (Get-Command winget.exe -ErrorAction Stop).Source
            $null = Start-Process -FilePath $wingetExe -ArgumentList @(
                'install', 'Google.Chrome', '-e',
                '--accept-package-agreements', '--accept-source-agreements', '--silent'
            ) -PassThru -Wait -NoNewWindow
        }
        catch { }

        Refresh-PathFromMachineAndUser

        Start-Sleep -Seconds 3

        if (-not (Get-ChromeExe) -and -not (Get-EdgeExe)) {
            Write-Warning 'Chrome did not detect after winget install. The script will fall back to your default browser when opening the UI.'
        }
    }

    function Invoke-NpmInstall {
        param([string]$Directory)

        Push-Location $Directory
        try {
            $pkg = Join-Path $Directory 'package.json'
            if (-not (Test-Path -LiteralPath $pkg)) {
                throw "Missing package.json in $Directory"
            }

            npm.cmd install --no-fund --no-audit --loglevel error
            if ($LASTEXITCODE -ne 0) {
                throw "npm install failed in $Directory (exit $LASTEXITCODE)"
            }
        }
        finally {
            Pop-Location
        }
    }

    function Get-ShellExe {
        $pw = Get-Command pwsh.exe -ErrorAction SilentlyContinue
        if ($pw -and $pw.Source -and (Test-Path -LiteralPath $pw.Source)) {
            return $pw.Source
        }
        foreach ($guess in @(
                (Join-Path $env:ProgramFiles 'PowerShell\7\pwsh.exe'),
                (${env:ProgramFiles(x86)} + '\PowerShell\7\pwsh.exe'))) {
            if (Test-Path -LiteralPath $guess) {
                return (Resolve-Path -LiteralPath $guess).Path
            }
        }
        return [System.Environment]::ExpandEnvironmentStrings('%windir%\System32\WindowsPowerShell\v1.0\powershell.exe')
    }

    function Start-ServiceWindow {
        param([string]$WorkDir, [string]$WindowTitle, [string]$ScriptLine)

        $shell = Get-ShellExe
        Start-Process -FilePath $shell `
            -WorkingDirectory $WorkDir `
            -ArgumentList @(
            '-NoLogo',
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-Command',
            "`$Host.UI.RawUI.WindowTitle = '$WindowTitle'; $ScriptLine"
        ) | Out-Null
    }

    # --- Main ---

    Write-Step 'Prerequisites — Node.js and npm.'
    Ensure-NodeInstalled

    Write-Step 'Prerequisites — Python (for native Node modules such as better-sqlite3).'
    Ensure-PythonInstalled

    foreach ($rel in @('server', 'web')) {
        $full = Join-Path $Root $rel
        if (-not (Test-Path -LiteralPath $full)) {
            Write-Host "Expected folder missing: $full" -ForegroundColor Red
            exit 4
        }
    }

    Write-Step 'Installing server dependencies…'
    Invoke-NpmInstall -Directory $ServerDir

    Write-Step 'Installing web dependencies (includes React/Vite toolchain via package.json).'
    Invoke-NpmInstall -Directory $WebDir

    Ensure-WebReactDependencies -WebDirectory $WebDir

    foreach ($port in @($ApiPort, $UiPort)) {
        if (Test-PortOpen -Port $port -TimeoutMs 400) {
            Write-Warning "Port $port is already in use. Stop the conflicting process if startup fails."
        }
    }

    Write-Step 'Starting API server (new window).'
    Start-ServiceWindow `
        -WorkDir $ServerDir `
        -WindowTitle ('Opportunity Tracker API :' + $ApiPort) `
        -ScriptLine "npm.cmd run start; Write-Host ''; Read-Host -Prompt 'Close this window stopped the API'"


    Wait-TcpListening -Port $ApiPort -Description 'API' -TimeoutSeconds 90 | Out-Null

    Write-Step 'Starting Vite dev server (new window).'
    Start-ServiceWindow `
        -WorkDir $WebDir `
        -WindowTitle ('Opportunity Tracker Web :' + $UiPort) `
        -ScriptLine "npm.cmd run dev; Write-Host ''; Read-Host -Prompt 'Close this window stopped the frontend'"

    if (-not (Wait-TcpListening -Port $UiPort -Description 'Vite frontend' -TimeoutSeconds 120)) {
        Write-Host 'ERROR: Frontend did not start. Inspect the Web console window.' -ForegroundColor Red
        Write-Host 'Press Enter to dismiss this launcher window.' -ForegroundColor Yellow
        Read-Host | Out-Null
        exit 6
    }

    Ensure-ChromeInstalled

    $url = 'http://localhost:{0}/' -f $UiPort
    $Chrome = Get-ChromeExe

    if ($Chrome) {
        Start-Process -FilePath $Chrome -ArgumentList @('--new-window', $url)
        Write-Host "Opened Chrome at $url" -ForegroundColor Green
    }
    elseif (Get-EdgeExe) {
        $edgeExe = Get-EdgeExe
        Start-Process -FilePath $edgeExe -ArgumentList $url
        Write-Host ("Opened Microsoft Edge at {0} (Chrome not found)" -f $url) -ForegroundColor Yellow
    }
    else {
        Start-Process $url
        Write-Host "Opened default browser at $url" -ForegroundColor Yellow
    }

    Write-Host ''
    Write-Host 'App is running. Close the API and Web console windows to stop the servers.' -ForegroundColor Cyan
}
catch {
    Write-Host ('ERROR: ' + $_.Exception.Message) -ForegroundColor Red
    if ($Host.Name -eq 'ConsoleHost') {
        Write-Host 'Press Enter to exit.' -ForegroundColor Yellow
        Read-Host | Out-Null
    }
    exit 1
}
