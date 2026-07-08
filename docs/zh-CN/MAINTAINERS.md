# 维护者指南

本项目公开仓库只聚焦当前维护的 Windows 桌面端。维护目标是让代码稳定、目录清晰、贡献者容易构建，评审者也容易判断改动风险。

## 评审原则

- 改动范围应聚焦桌面 UI、Windows 壳、打包脚本或文档。
- UI 改动建议保持 PR 小而清晰，并附截图或录屏。
- 不提交 `dist/`、`bin/`、`obj/`、`artifacts/` 或本地报告等生成物。
- 不提交凭据、生产端点、私有现场配置或本机环境值。
- 合并前应确认 CI 通过。

## 依赖更新

Dependabot 已配置为低噪音的每周更新：

- npm 依赖按运行时依赖和工具链依赖分组。
- GitHub Actions 依赖单独分组。
- semver-major 更新默认忽略，应在项目准备好做兼容性评审时手动处理。

评审依赖更新时运行：

```powershell
npm audit
npm run lint
npm run build
dotnet build .\apps\windows-shell\LandslideDesk.Win\LandslideDesk.Win.csproj -c Release
```

如果改动涉及打包流程，还需要运行：

```powershell
npm run desktop:publish
```

## 发布前检查

创建 release 前确认：

- README 和 `docs/` 与当前桌面端范围一致。
- `CHANGELOG.md` 有对应日期的记录。
- Windows 发布包包含 `web/index.html`。
- 清理生成物后工作区干净。
- main 分支 CI 为绿色。
