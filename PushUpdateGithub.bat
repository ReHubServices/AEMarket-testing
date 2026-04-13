@echo off
echo ================================================
echo AE Empire Accounts - Setup + Upload
echo ================================================
echo.

cd /d "D:\website\AE Market"

echo Checking if Git is initialized...

if not exist ".git" (
    echo Initializing new Git repository...
    git init
    git branch -M main
    git remote add origin https://github.com/ReHubServices/AEMarket-testing.git
    echo Git repository initialized and connected.
) else (
    echo Git repository already exists.
)

echo.
echo Adding all changes...
git add .

set /p commitmsg="Enter commit message (or press Enter for default): "
if "%commitmsg%"=="" set commitmsg=Update AE Empire Accounts

echo.
echo Committing...
git commit -m "%commitmsg%" || echo Nothing new to commit.

echo.
echo Pushing to GitHub...
git push -u origin main --force

echo.
echo ================================================
echo Done! Repository is now connected and changes uploaded.
echo Check: https://github.com/ReHubServices/AEMarket-testing
echo.
pause