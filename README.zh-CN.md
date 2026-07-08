# 山体滑坡监测桌面端

[![CI](https://github.com/kipp7/landslide-monitoring-desktop/actions/workflows/ci.yml/badge.svg)](https://github.com/kipp7/landslide-monitoring-desktop/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Windows](https://img.shields.io/badge/platform-Windows-0078D4.svg)](apps/windows-shell)
[![React](https://img.shields.io/badge/UI-React%20%2B%20Vite-61DAFB.svg)](apps/desktop-ui)
[![TypeScript](https://img.shields.io/badge/Language-TypeScript-3178C6.svg)](apps/desktop-ui)

[English](README.md) | 简体中文

一个面向山体滑坡监测、现场设备管理和预警业务的 Windows 桌面端项目。

这个仓库只保留当前实际维护的桌面端：React/Vite 监测界面 + WPF/WebView2 原生 Windows 壳。Web 端、移动端、后端服务、部署基础设施、内部日志和私有环境配置没有进入这个公开仓库，目的是让项目边界更清晰，也更适合公开维护。

## 项目定位

山体滑坡监测场景需要一个稳定的操作员客户端，用来查看监测点、现场设备状态、GPS 形变趋势、预警信息和系统状态。这个仓库提供的就是这一层桌面端能力：界面可迭代，Windows 可打包，代码结构适合公开协作。

## 亮点

- 覆盖监测点、设备、GPS 形变、预警复核、账号和系统状态等桌面端工作区。
- 原生 Windows 壳采用 WPF + WebView2，支持启动前置检查、托盘能力和静态资源打包。
- 默认支持 mock 数据开发，不需要部署后端即可预览和调试界面。
- 提供标准化 Windows 打包脚本，可生成便携包，也可扩展安装器流程。
- 按公开开源项目整理：中英文文档、CI、Issue 模板、安全策略、MIT License。

## 功能范围

| 模块 | 说明 |
| --- | --- |
| 首页总览 | 展示关键监测点和系统运行概况。 |
| 设备管理 | 设备列表、指令动作、诊断信息和现场状态查看。 |
| GPS 监测 | GPS 形变视图、导出路径和阈值相关工作流。 |
| 分析页面 | 基于图表、地图和领域 mock 数据的分析界面。 |
| Windows 壳 | WPF/WebView2 宿主，用于桌面运行和打包发布。 |

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 桌面 UI | React 18、TypeScript、Vite、Ant Design |
| 可视化 | ECharts、Leaflet、Three.js |
| 原生壳 | .NET 8、WPF、WebView2 |
| 工程化 | npm workspaces、ESLint、Prettier、GitHub Actions |

## 目录结构

```text
apps/
  desktop-ui/       React + Vite 桌面监测界面
  windows-shell/    WPF + WebView2 宿主、安装器资源、启动检查
docs/
  ARCHITECTURE.md   英文架构说明
  RELEASE.md        英文发布流程
  zh-CN/            中文文档
  reports/          本地生成报告，不作为发布产物提交
scripts/
  desktop/          桌面端开发、打包、验证脚本
```

## 环境要求

- Windows 10/11
- Node.js 20+
- npm 10+
- 带 Windows Desktop 支持的 .NET 8 SDK
- Microsoft Edge WebView2 Runtime

## 快速开始

```powershell
git clone https://github.com/kipp7/landslide-monitoring-desktop.git
cd landslide-monitoring-desktop
npm install
npm run dev
```

UI 开发服务器默认运行在 `http://localhost:5174/`。

启动 Windows 原生壳并连接到开发服务器：

```powershell
npm run desktop:dev
```

## 构建与打包

构建 React 桌面 UI：

```powershell
npm run build
```

生成默认 Windows 便携包：

```powershell
npm run desktop:publish
```

默认输出：

- `artifacts/windows/portable/`
- `docs/reports/windows-package-latest.json`

## 验证

```powershell
npm audit
npm run lint
npm run build
dotnet build .\apps\windows-shell\LandslideDesk.Win\LandslideDesk.Win.csproj -c Release
```

打包后可验证桌面包：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\desktop\verify-windows-package.ps1
```

## 文档

- [文档总览](docs/zh-CN/README.md)
- [架构说明](docs/zh-CN/ARCHITECTURE.md)
- [发布流程](docs/zh-CN/RELEASE.md)
- [英文文档总览](docs/README.md)
- [英文架构说明](docs/ARCHITECTURE.md)
- [英文发布流程](docs/RELEASE.md)
- [Desktop UI 包说明](apps/desktop-ui/README.md)
- [Windows 壳说明](apps/windows-shell/README.md)
- [贡献指南](CONTRIBUTING.md)
- [中文贡献指南](CONTRIBUTING.zh-CN.md)
- [安全策略](SECURITY.md)

## 项目状态

这是一个只公开桌面客户端的仓库。当前适合用于 UI 预览、Windows 打包，以及对接兼容的山体滑坡监测 API。后续可以继续补充公开 demo 数据、截图、签名安装包和正式 Release。

## 贡献

欢迎提交 Issue 和 Pull Request。请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

## License

本项目使用 [MIT License](LICENSE) 开源。
