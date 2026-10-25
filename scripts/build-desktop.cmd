@echo off
rem Build the Tauri desktop binary for local debugging.
rem This machine needs the MSVC environment plus clang-cl (ring compiles C code),
rem otherwise cargo fails with "cl.exe D8050".
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
if errorlevel 1 exit /b %errorlevel%
node "%~dp0prepare-executor.mjs"
if errorlevel 1 exit /b %errorlevel%
set "CC=C:\Program Files\LLVM\bin\clang-cl.exe"
set "CXX=C:\Program Files\LLVM\bin\clang-cl.exe"
cargo build --manifest-path "%~dp0..\src-tauri\Cargo.toml"
if errorlevel 1 exit /b %errorlevel%
node "%~dp0prepare-windows-runtime.mjs" desktop
