<#
.SYNOPSIS
    每日抽卡 Node 服务：一键打包 + 推送到服务器。

.DESCRIPTION
    1. 重新生成 update\（只含生产所需文件，不含 node_modules / scripts / .env）
    2. 打包成 update.tar.gz
    3. 配置了 -Server 时：scp 上传 -> 远程备份旧版本 -> 解包覆盖 -> npm install + pm2 重启
    4. 未配置 -Server 时：只打包，并打印手动上传步骤

.EXAMPLE
    .\updatePush.ps1
    只打包，不推送。

.EXAMPLE
    .\updatePush.ps1 -Server 1.2.3.4 -User root
    打包并推送到 1.2.3.4。

.EXAMPLE
    .\updatePush.ps1 -Server 1.2.3.4 -Force -SkipInstall
    不确认直接上传，只更新文件不动依赖与进程。

.NOTES
    本文件保存为 UTF-8 with BOM，Windows PowerShell 5.1 与 PowerShell 7 都能正确读取。
    登录方式：首次会提示输入服务器密码；配置 SSH 公钥后可完全无人值守。
#>
[CmdletBinding()]
param(
    # 服务器 IP 或域名；留空 = 只打包不上传
    [string]$Server,

    # SSH 登录用户
    [string]$User,

    # SSH 端口
    [int]$Port,

    # 服务器上的目标目录（解包后 src/ public/ package.json 直接在这里）
    [string]$TargetDir,

    # 只上传文件，不在服务器上执行 npm ci / pm2 重启
    [switch]$SkipInstall,

    # 跳过上传前的确认
    [switch]$Force,

    # 只预览将要执行的远程命令，不实际上传、不远程执行
    [switch]$DryRun
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

# ============================== 配置区 ==============================
$Config = [ordered]@{
    Server        = ''                                                    # ← 填服务器 IP，例如 '1.2.3.4'
    User          = 'root'
    Port          = 22
    TargetDir     = '/www/wwwroot/astrbot_plugin_dailycarddraw/server'
    RemoteInstall = $true      # 上传后自动 npm ci + pm2 重启
    RemoteBackup  = $true      # 解包前把服务器上现有版本备份到 /tmp
    AskBeforePush = $false     # $true = 上传前确认一次
    AppName       = 'daily-carddraw-server'
    HealthUrl     = 'http://127.0.0.1:3100/health'
}

if ($PSBoundParameters.ContainsKey('Server'))    { $Config.Server = $Server }
if ($PSBoundParameters.ContainsKey('User'))      { $Config.User = $User }
if ($PSBoundParameters.ContainsKey('Port'))      { $Config.Port = $Port }
if ($PSBoundParameters.ContainsKey('TargetDir')) { $Config.TargetDir = $TargetDir }
if ($SkipInstall) { $Config.RemoteInstall = $false }
if ($Force)       { $Config.AskBeforePush = $false }

$PackageName      = 'update.tar.gz'
$RemoteTmp        = "/tmp/$PackageName"
$RemoteBackupFile = '/tmp/daily-carddraw-server-backup.tar.gz'
$LogFile          = 'update-push.log'
$ScriptDir        = Split-Path -Parent $MyInvocation.MyCommand.Path
# ====================================================================

function Write-Log {
    param(
        [AllowEmptyString()][string]$Message,
        [ValidateSet('Info', 'Step', 'Warn', 'Error', 'Plain')][string]$Level = 'Plain'
    )
    $line = "[{0}] {1}" -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $Message
    Add-Content -Path (Join-Path $ScriptDir $LogFile) -Value $line -Encoding UTF8

    switch ($Level) {
        'Step'  { Write-Host $Message -ForegroundColor Cyan }
        'Info'  { Write-Host $Message -ForegroundColor Green }
        'Warn'  { Write-Host $Message -ForegroundColor Yellow }
        'Error' { Write-Host $Message -ForegroundColor Red }
        default { Write-Host $Message }
    }
}

function Invoke-Native {
    param(
        [Parameter(Mandatory)][string]$Command,
        [Parameter(Mandatory)][string[]]$Arguments
    )
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "命令执行失败（退出码 $LASTEXITCODE）：$Command $($Arguments -join ' ')"
    }
}

try {
    Set-Location $ScriptDir
    Set-Content -Path (Join-Path $ScriptDir $LogFile) -Value "=== updatePush $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===" -Encoding UTF8

    Write-Host ''
    Write-Host '===========================================================' -ForegroundColor DarkCyan
    Write-Host '  每日抽卡 Node 服务 · 打包与推送' -ForegroundColor White
    Write-Host "  工作目录：$ScriptDir" -ForegroundColor DarkGray
    Write-Host '===========================================================' -ForegroundColor DarkCyan
    Write-Host ''

    # ---------------------------- 1/4 生成 update\ ----------------------------
    Write-Log '[1/4] 生成 update\ 目录 ...' -Level Step
    if (Test-Path 'update') { Remove-Item 'update' -Recurse -Force }
    New-Item -ItemType Directory -Path 'update' | Out-Null

    foreach ($dir in @('src', 'public', 'sql', 'deploy')) {
        if (-not (Test-Path $dir)) { throw "缺少目录：$dir" }
        Copy-Item -Path $dir -Destination 'update\' -Recurse -Force
    }
    foreach ($file in @('package.json', 'package-lock.json', 'ecosystem.config.js', '.env.example', 'README.md')) {
        if (-not (Test-Path $file)) { throw "缺少文件：$file" }
        Copy-Item -Path $file -Destination 'update\' -Force
    }

    $gitSha = 'unknown'
    if (Get-Command git -ErrorAction SilentlyContinue) {
        $sha = (& git rev-parse --short HEAD 2>$null | Select-Object -First 1)
        if ($sha) { $gitSha = $sha.Trim() }
    }

    @(
        "built_at=$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))"
        "git_commit=$gitSha"
        "built_from=$ScriptDir"
        'note=node_modules 与 .env 不在包内，需在服务器上生成'
    ) | Set-Content -Path 'update\VERSION.txt' -Encoding UTF8

    $fileCount = (Get-ChildItem 'update' -Recurse -File).Count
    Write-Log "      完成：$fileCount 个文件（git $gitSha）" -Level Info

    # ---------------------------- 2/4 打包 ------------------------------------
    Write-Log '[2/4] 打包 ...' -Level Step
    if (Test-Path $PackageName) { Remove-Item $PackageName -Force }
    if (-not (Get-Command tar -ErrorAction SilentlyContinue)) {
        throw '找不到 tar 命令（Windows 10 1803+ 自带）；可改用宝塔文件管理器手动上传 update\ 目录'
    }
    Invoke-Native -Command 'tar' -Arguments @('-a', '-cf', $PackageName, '-C', 'update', '.')
    $packageKb = [math]::Round((Get-Item $PackageName).Length / 1KB, 1)
    Write-Log "      完成：$PackageName（$packageKb KB）" -Level Info

    # ---------------------------- 3/4 上传 ------------------------------------
    if (-not $Config.Server) {
        Write-Log '' -Level Plain
        Write-Log '[3/4] 未配置 Server，跳过上传。' -Level Warn
        Write-Host ''
        Write-Host '  两种上传方式：' -ForegroundColor White
        Write-Host "   a) 宝塔文件管理器：把 $(Join-Path $ScriptDir $PackageName) 传到 $($Config.TargetDir)"
        Write-Host '      然后在服务器终端执行：'
        Write-Host "         cd $($Config.TargetDir) && tar -xzf $PackageName && npm install --omit=dev && pm2 start ecosystem.config.js" -ForegroundColor DarkGray
        Write-Host '   b) 本脚本加参数重跑，自动上传并重启：'
        Write-Host '         .\updatePush.ps1 -Server 你的服务器IP' -ForegroundColor DarkGray
        Write-Host ''
        Write-Log '[完成] 仅打包，未上传。' -Level Info
        exit 0
    }

    foreach ($tool in @('ssh', 'scp')) {
        if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
            throw "找不到 $tool 命令：Windows 设置 → 应用 → 可选功能 → 添加「OpenSSH 客户端」"
        }
    }

    if ($Config.AskBeforePush) {
        $answer = Read-Host "确认上传到 $($Config.User)@$($Config.Server):$($Config.TargetDir) ? [y/N]"
        if ($answer -notmatch '^[Yy]') {
            Write-Log '已取消上传，本地包已保留。' -Level Warn
            exit 0
        }
    }

    if ($DryRun) {
        Write-Log '[3/4] -DryRun：跳过上传。' -Level Warn
    }
    else {
        Write-Log "[3/4] 上传到 $($Config.User)@$($Config.Server):$RemoteTmp ..." -Level Step
        Invoke-Native -Command 'scp' -Arguments @(
            '-P', "$($Config.Port)",
            '-o', 'StrictHostKeyChecking=accept-new',
            '-o', 'ConnectTimeout=10',
            $PackageName,
            "$($Config.User)@$($Config.Server):$RemoteTmp"
        )
        Write-Log '      上传完成' -Level Info
    }

    # ---------------------------- 4/4 远程解包与重启 ---------------------------
    if (-not $DryRun) { Write-Log '[4/4] 远程解包与重启 ...' -Level Step }

    $backupCommand = if ($Config.RemoteBackup) {
        'tar -czf "$BACKUP" --exclude=node_modules --exclude=.env -C "$TARGET" . && echo "[remote] 旧版本已备份到 $BACKUP"'
    } else {
        ':'
    }

    $installCommand = if ($Config.RemoteInstall) {
        @'
cd "$TARGET"
command -v npm >/dev/null 2>&1 || { echo "[remote][x] 找不到 npm，请在宝塔终端手动执行 npm install --omit=dev"; exit 1; }
npm install --omit=dev
command -v pm2 >/dev/null 2>&1 || { echo "[remote][x] 找不到 pm2，请手动执行 pm2 start ecosystem.config.js"; exit 1; }
if pm2 describe __APP__ >/dev/null 2>&1; then pm2 restart ecosystem.config.js --update-env; else pm2 start ecosystem.config.js; fi
pm2 save >/dev/null 2>&1 || true
curl -fsS __HEALTH__ >/dev/null 2>&1 && echo "[remote] 健康检查通过" || echo "[remote][!] 健康检查未通过，请查看 pm2 logs __APP__"
'@
    } else {
        'echo "[remote] 已跳过依赖安装与重启（-SkipInstall）"'
    }

    $remoteCommand = @'
set -e
TARGET='__TARGET__'
TMP='__TMP__'
BACKUP='__BACKUP__'
mkdir -p "$TARGET"
if [ -f "$TARGET/package.json" ]; then
  __BACKUP_CMD__
fi
tar -xzf "$TMP" -C "$TARGET"
echo "[remote] 文件已更新（.env 与 node_modules 未改动）"
__INSTALL_CMD__
'@

    $remoteCommand = $remoteCommand.
        Replace('__TARGET__', $Config.TargetDir).
        Replace('__TMP__', $RemoteTmp).
        Replace('__BACKUP__', $RemoteBackupFile).
        Replace('__BACKUP_CMD__', $backupCommand).
        Replace('__INSTALL_CMD__', $installCommand).
        Replace('__APP__', $Config.AppName).
        Replace('__HEALTH__', $Config.HealthUrl)

    if ($DryRun) {
        Write-Host ''
        Write-Host '--- 将要执行的远程命令（-DryRun 预览）---' -ForegroundColor White
        Write-Host $remoteCommand
        Write-Host ''
        Write-Log '[DryRun] 仅预览：未上传、未远程执行。' -Level Warn
        exit 0
    }

    Invoke-Native -Command 'ssh' -Arguments @(
        '-p', "$($Config.Port)",
        '-o', 'StrictHostKeyChecking=accept-new',
        '-o', 'ConnectTimeout=10',
        "$($Config.User)@$($Config.Server)",
        $remoteCommand
    )
    Write-Log '      远程执行完成' -Level Info

    Write-Log '' -Level Plain
    Write-Log '[完成] 已部署到服务器。' -Level Info
    Write-Host "  本地包：$(Join-Path $ScriptDir $PackageName)" -ForegroundColor DarkGray
    Write-Host "  日志：  $(Join-Path $ScriptDir $LogFile)" -ForegroundColor DarkGray
    Write-Host ''
    exit 0
}
catch {
    Write-Host ''
    Write-Log "[失败] $($_.Exception.Message)" -Level Error
    Write-Host "  详细日志：$(Join-Path $ScriptDir $LogFile)" -ForegroundColor DarkGray
    Write-Host ''
    exit 1
}
