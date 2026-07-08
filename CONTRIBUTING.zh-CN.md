# 贡献指南

[English](CONTRIBUTING.md)

感谢你帮助改进 Landslide Monitoring Desktop。

## 开发环境

```powershell
npm install
npm run dev
```

启动原生 Windows 壳：

```powershell
npm run desktop:dev
```

## 提交 Pull Request 前

根据改动范围运行检查：

```powershell
npm audit
npm run lint
npm run build
```

如果改动涉及 Windows 打包，也请运行：

```powershell
npm run desktop:publish
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\desktop\verify-windows-package.ps1
```

## Pull Request 规范

- 每个 PR 聚焦一个功能、修复或文档主题。
- UI 改动请附截图或短录屏。
- 命令、安装流程或行为变化需要同步更新文档。
- 不要提交 `artifacts/`、`dist/`、`bin/`、`obj/` 等生成产物。
- 不要提交真实凭据、现场部署细节、私有接口或本地环境文件。

## 项目约定

- 使用面向公开项目的目录名，例如 `apps/desktop-ui` 和 `apps/windows-shell`。
- 桌面端自动化脚本统一放在 `scripts/desktop`。
- 本地打包报告统一放在 `docs/reports`。
- 项目门面变化应同步更新 `README.md` 和 `README.zh-CN.md`。
- 优先保留清晰的工程文档，不提交内部工作日志。

## Commit 风格

建议使用简洁的 conventional-style 前缀：

- `feat:` 用户可见的新功能
- `fix:` Bug 修复
- `docs:` 文档
- `chore:` 工程维护
- `ci:` CI 配置
