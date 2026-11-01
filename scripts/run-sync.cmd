@echo off
rem Do Windows Task Scheduler goi: dong bo LMS + FAP len Google Calendar.
rem Log ghi vao logs\sync-YYYY-MM-DD.log (moi ngay mot file). Log cu tu bi xoa sau moi lan chay
rem (xem LOG_RETENTION_DAYS trong .env).
setlocal
cd /d "%~dp0.."
if not exist logs mkdir logs

rem Lay ngay hien tai dang YYYY-MM-DD, khong phu thuoc cai dat vung/ngon ngu cua Windows
set TODAY=
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set TODAY=%%i
if not defined TODAY set TODAY=unknown

call npm start -- --non-interactive >> "logs\sync-%TODAY%.log" 2>&1
exit /b %ERRORLEVEL%
