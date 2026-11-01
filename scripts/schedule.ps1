<#
  Quản lý job tự chạy `npm start` trên Windows Task Scheduler (mặc định mỗi 2 giờ).

  Dùng qua npm (tại thư mục dự án):
    npm run schedule:install     cài job (lần đầu chạy sau 1 phút, rồi lặp mỗi 2 giờ); chạy lại để đổi nhịp
    npm run schedule:status      xem lần chạy gần nhất / kế tiếp và 15 dòng cuối của log
    npm run schedule:run         chạy ngay một lần, đợi xong rồi hiện kết quả
    npm run schedule:remove      gỡ job

  Tùy chọn khi gọi trực tiếp:  -EveryHours 4   -TaskName Ten   -DryRun (chỉ in ra, không cài)
#>
param(
  [ValidateSet("install", "remove", "status", "run")][string]$Action = "status",
  [ValidateRange(1, 24)][int]$EveryHours = 2,
  [string]$TaskName = "EduScheduleImporter",
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$root = Split-Path -Parent $PSScriptRoot
$runner = Join-Path $PSScriptRoot "run-sync.cmd"
$log = Join-Path $root "logs\sync.log"

function Get-Job { Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue }

function Show-Log([int]$Lines = 15) {
  if (Test-Path $log) {
    Write-Host "`n--- $Lines dòng cuối của logs\sync.log ---"
    Get-Content $log -Tail $Lines -Encoding UTF8
  } else {
    Write-Host "`n(chưa có logs\sync.log vì job chưa chạy lần nào)"
  }
}

function Show-Info {
  $i = Get-ScheduledTaskInfo -TaskName $TaskName
  $meaning = switch ($i.LastTaskResult) {
    0 { "ổn" }
    1 { "có lỗi khi đồng bộ (xem log)" }
    2 { "CẦN ĐĂNG NHẬP LẠI GOOGLE: chạy npm start rồi đăng nhập" }
    267011 { "chưa chạy lần nào" }
    default { "mã khác (xem log)" }
  }
  Write-Host ("Trạng thái      : {0}" -f (Get-Job).State)
  Write-Host ("Lần chạy gần nhất: {0}" -f $i.LastRunTime)
  Write-Host ("Kết quả          : {0} ({1})" -f $i.LastTaskResult, $meaning)
  Write-Host ("Lần chạy kế tiếp : {0}" -f $i.NextRunTime)
}

switch ($Action) {
  "install" {
    # powershell ẩn cửa sổ gọi run-sync.cmd; `exit $LASTEXITCODE` để mã thoát của npm start hiện ở LastTaskResult
    $cmd = "& '$runner'; exit `$LASTEXITCODE"
    $arg = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command `"$cmd`""
    $act = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arg -WorkingDirectory $root
    $trg = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
             -RepetitionInterval (New-TimeSpan -Hours $EveryHours) -RepetitionDuration (New-TimeSpan -Days 3650)
    # StartWhenAvailable: tắt máy lúc đến giờ thì chạy bù ngay khi bật lại. IgnoreNew: không chạy chồng nhau.
    $set = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
             -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
    # Chỉ chạy khi bạn đã đăng nhập Windows (không cần lưu mật khẩu)
    $pri = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

    Write-Host "Job '$TaskName': chạy mỗi $EveryHours giờ khi bạn đã đăng nhập Windows."
    Write-Host "  Lệnh : powershell.exe $arg"
    Write-Host "  Log  : $log"
    if ($DryRun) { Write-Host "(-DryRun: chưa cài gì)"; return }

    Register-ScheduledTask -TaskName $TaskName -Action $act -Trigger $trg -Settings $set -Principal $pri `
      -Description "Đồng bộ LMS + FAP lên Google Calendar (npm start --non-interactive)" -Force | Out-Null
    Write-Host "`nĐã cài. Lần chạy đầu sau khoảng 1 phút."
    Show-Info
  }
  "remove" {
    if (-not (Get-Job)) { Write-Host "Job '$TaskName' chưa được cài."; return }
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Đã gỡ job '$TaskName'. (logs\sync.log được giữ lại)"
  }
  "status" {
    if (-not (Get-Job)) { Write-Host "Chưa cài job '$TaskName'. Cài bằng: npm run schedule:install"; return }
    Show-Info
    Show-Log
  }
  "run" {
    if (-not (Get-Job)) { throw "Chưa cài job '$TaskName'. Cài bằng: npm run schedule:install" }
    Start-ScheduledTask -TaskName $TaskName
    Write-Host "Đang chạy..."
    $deadline = (Get-Date).AddMinutes(5)
    do { Start-Sleep -Seconds 2 } while ((Get-Job).State -eq "Running" -and (Get-Date) -lt $deadline)
    Show-Info
    Show-Log 25
  }
}
