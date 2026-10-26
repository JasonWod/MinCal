# MinCal - Windows Build Script
# Run this on a Windows machine with Rust + Node.js installed
# Produces: src-tauri/target/release/bundle/nsis/MinCal.exe

Write-Host "=== MinCal Windows Build ===" -ForegroundColor Cyan

# Check prerequisites
$ErrorActionPreference = "Stop"

Write-Host "Checking prerequisites..."
$rust = (Get-Command rustc -ErrorAction SilentlyContinue)
if (-not $rust) {
    Write-Host "[!] Rust not found. Installing via rustup..." -ForegroundColor Yellow
    Invoke-Expression (New-Object Net.WebClient).DownloadString('https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe')
    Start-Process rustup-init.exe -ArgumentList "-y" -Wait
}
$node = (Get-Command node -ErrorAction SilentlyContinue)
if (-not $node) {
    Write-Host "[ERROR] Node.js not found. Please install Node.js 18+ first." -ForegroundColor Red
    exit 1
}

Write-Host "Installing frontend dependencies..." -ForegroundColor Green
Set-Location $PSScriptRoot\..
npm install

Write-Host "Building Tauri app..." -ForegroundColor Green
npx tauri build

Write-Host ""
Write-Host "=== Build Complete! ===" -ForegroundColor Green
Write-Host "Installer: client\src-tauri\target\release\bundle\nsis\MinCal Setup 0.1.0.exe"
Write-Host "Copy this .exe to your colleagues' Windows machines."
