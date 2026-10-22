@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Quadrant - Local Server
if exist "%~dp0QuadrantServerV2.exe" goto bundledv2
if exist "%~dp0QuadrantServer.exe" goto bundled
where py >nul 2>nul
if not errorlevel 1 goto pythonlauncher
where python >nul 2>nul
if not errorlevel 1 goto python
echo Please install Python 3.10 or later, or use the Windows ready-to-run package.
pause
exit /b 1
:bundledv2
"%~dp0QuadrantServerV2.exe" %*
if errorlevel 1 pause
exit /b
:bundled
"%~dp0QuadrantServer.exe" %*
if errorlevel 1 pause
exit /b
:pythonlauncher
py -3 "%~dp0server.py" %*
if errorlevel 1 pause
exit /b
:python
python "%~dp0server.py" %*
if errorlevel 1 pause
