@echo off
echo Starting WorkShift...
echo.

echo Installing backend dependencies...
cd backend
call npm install
echo.

echo Installing frontend dependencies...
cd ..\frontend
call npm install
echo.

echo Starting backend server...
cd ..\backend
start "WorkShift Backend" cmd /k "npm run dev"

echo Starting frontend dev server...
cd ..\frontend
start "WorkShift Frontend" cmd /k "npm run dev"

echo.
echo WorkShift is starting!
echo Backend: http://localhost:3001
echo Frontend: http://localhost:5173
echo.
pause
