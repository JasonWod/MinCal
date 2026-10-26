# MinCal - 团队日历同步工具

极简美观的 Windows 桌面日历应用，macOS 设计风格，数据自托管，团队实时双向同步。

## 功能

- 📅 **托盘弹出层**：右下角系统托盘，点击弹出今日+近几天日程（毛玻璃 macOS 风格）
- 🖥️ **完整日历窗口**：月/周/日视图，FullCalendar 驱动
- 🔄 **实时双向同步**：团队成员修改日程，所有人实时更新
- 📴 **离线可用**：断网时本地 SQLite 缓存，恢复后自动同步
- 🎨 **macOS 设计**：毛玻璃、圆角、中性灰+靛蓝、精致动效

## 架构

```
Windows Client (Tauri 2 + React)  ←→  FastAPI Backend (Docker)  ←→  PostgreSQL
   托盘弹出层 + 完整窗口                   REST + WebSocket            事件存储
```

## 快速开始（开发）

### 1. 启动后端

```bash
cd ~/projects/mincal
# 创建数据库（在 100.66.1.1:5432 上）
psql -h 100.66.1.1 -U mincal -c "CREATE DATABASE mincal"

# Docker 启动
docker-compose up -d
```

### 2. 前端开发

```bash
cd client
npm install
npm run dev  # Vite dev server on :25173
```

### 3. Tauri 开发（需要 Rust）

```bash
cd client
npx tauri dev  # 本地调试
```

## 构建 Windows 安装包

### 方式 A：在 Windows 机器上

```powershell
# 前置：安装 Rust (rustup) + Node.js 18+
# 然后运行：
.\scripts\build-windows.ps1
```

产出：`client/src-tauri/target/release/bundle/nsis/MinCal Setup 0.1.5.exe`

### 方式 B：GitHub Actions

推送到 GitHub，自动触发 `build-windows.yml`，在 Release 中下载 .exe。

## 部署

### 后端（1Panel Docker）

将 `docker-compose.yml` 放入 1Panel 应用目录：
```
/opt/1panel/apps/mincal/mincal/docker-compose.yml
```

端口：**28091**

### 客户端分发

将构建好的 .exe 发送给同事，安装后首次启动输入服务器地址即可。

## 项目结构

```
mincal/
├── backend/           # FastAPI 后端
│   ├── app/
│   │   ├── auth/      # JWT 认证
│   │   ├── events/    # 事件 CRUD
│   │   ├── sync/      # 同步引擎 + WebSocket
│   │   ├── users/     # 用户管理
│   │   └── db/        # SQLAlchemy 模型
│   ├── Dockerfile
│   └── requirements.txt
├── client/            # Tauri + React 前端
│   ├── src-tauri/     # Rust 壳（托盘、窗口管理）
│   └── src/
│       ├── components/
│       │   ├── TrayPopup/   # 托盘弹出层
│       │   ├── Calendar/    # 完整日历
│       │   ├── Login.tsx
│       │   └── Settings.tsx
│       ├── stores/          # Zustand 状态
│       └── lib/             # API client + types
├── .github/workflows/ # CI（自动构建 Windows .exe）
├── scripts/           # 构建脚本
├── docker-compose.yml
└── docs/PRD.md
```
