# 发布流程

本文档说明 Windows 桌面客户端的本地打包和发布准备流程。

## 发布前检查

```powershell
npm install
npm audit
npm run lint
npm run build
dotnet build .\apps\windows-shell\LandslideDesk.Win\LandslideDesk.Win.csproj -c Release
```

## 便携包

```powershell
npm run desktop:publish
```

默认输出：

- `artifacts/windows/portable/`
- `docs/reports/windows-package-latest.json`

## 验证桌面包

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\desktop\verify-windows-package.ps1
```

## 可选：自包含包

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\desktop\package-windows-self-contained.ps1
```

默认输出：

- `artifacts/windows/self-contained/`
- `docs/reports/windows-self-contained-package-latest.json`

## 可选：安装器

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\desktop\build-windows-installer.ps1
```

安装器生成需要 Inno Setup 6。脚本会在需要时下载 WebView2 bootstrapper。

## GitHub Release 检查清单

- `main` 分支 CI 通过。
- `npm audit` 为 0 个漏洞。
- `npm run lint` 和 `npm run build` 通过。
- Windows 壳 Release 构建通过。
- 便携包已生成并验证。
- `CHANGELOG.md` 已更新。
- 没有提交生成产物、本地环境文件或凭据。
