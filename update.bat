@echo off
echo ================================================
echo AE Empire Accounts - Deploy to Vercel
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
echo Pushing to GitHub (this will trigger Vercel redeploy)...
git push origin main

echo.
echo ================================================
echo Done!
echo Vercel should start building automatically now.
echo Check your Vercel dashboard in 30-60 seconds.
echo.
pause