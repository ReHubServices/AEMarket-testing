@echo off
echo ================================================
echo AE Empire Accounts - Upload Changes
echo ================================================
echo.

cd /d "D:\website\AE Market"

echo Adding all changes...
git add .

set /p commitmsg="Enter commit message (or press Enter for default): "
if "%commitmsg%"=="" set commitmsg=Update AE Empire Accounts

echo.
echo Committing...
git commit -m "%commitmsg%" || echo Nothing new to commit.

echo.
echo Pushing to GitHub...
git push origin main

echo.
echo ================================================
echo Done! Changes uploaded to https://github.com/ReHubServices/AEMarket-testing
echo.
pause