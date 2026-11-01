@echo off
rem Do Windows Task Scheduler goi: dong bo LMS + FAP len Google Calendar, ghi log vao logs\sync.log
setlocal
cd /d "%~dp0.."
if not exist logs mkdir logs

rem Quay vong log: qua 1 MB thi doi ten thanh sync.old.log (giu 1 ban cu)
if exist logs\sync.log for %%F in (logs\sync.log) do if %%~zF GTR 1048576 move /y logs\sync.log logs\sync.old.log >nul 2>&1

call npm start -- --non-interactive >> logs\sync.log 2>&1
exit /b %ERRORLEVEL%
