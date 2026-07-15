# 架构说明

Landslide Monitoring Desktop 是一个桌面端优先的小型工作区。公开仓库只保留清晰的运行边界：React 监测界面、Windows 原生壳和打包脚本。

## 系统边界

```text
操作员
  -> Windows 壳（WPF + WebView2）
    -> 桌面 UI（React + Vite）
      -> Mock 数据或兼容的监测 API
```

早期 Web、移动端、后端和部署相关工作不属于当前桌面端维护范围。公开树保持小而清晰，方便贡献者快速理解应用边界。

## 应用目录

| 路径 | 职责 |
| --- | --- |
| `apps/desktop-ui` | React + Vite 监测界面，包括路由、状态、图表、地图和 mock 数据。 |
| `apps/windows-shell` | WPF/WebView2 原生宿主，包括启动检查、托盘能力和安装器资源。 |

## 桌面 UI

桌面 UI 负责操作员直接使用的工作流：

- 首页总览和关键监测点状态
- 设备管理和指令相关页面
- GPS 形变和监测视图
- 基于图表、地图、领域 mock 数据的分析页面
- 账号、设置和系统状态页面

开发时可以独立运行：

```powershell
npm run dev
```

## Windows 壳

原生壳有两种加载模式：

- 开发模式：读取 `DESK_DEV_SERVER_URL`，通常为 `http://localhost:5174/`
- 打包模式：从发布目录中的 `web/` 静态资源加载界面

Windows 壳还负责窗口生命周期、启动前置检查、打包资源加载和托盘集成等平台能力。

## 打包流程

1. 将 `apps/desktop-ui` 构建到 `apps/desktop-ui/dist`。
2. 使用 .NET 发布 `apps/windows-shell`。
3. 将静态 UI 构建结果复制到桌面包的 `web/` 目录。
4. 将本地打包报告写入 `docs/reports/`。

## 设计原则

- 公开仓库只聚焦当前维护的桌面客户端。
- 使用清晰目录名，避免内部缩写。
- 生成产物不提交到 Git。
- 通过 mock 数据支持无后端 UI 开发。
- 通过脚本保持 Windows 打包流程可复现。
