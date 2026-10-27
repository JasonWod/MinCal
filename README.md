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

## 给普通用户：直接下载安装

到 **Releases** 页面取包，不需要装任何开发环境：
https://github.com/JasonWod/MinCal/releases

- **安装包** `MinCal Setup <版本>.exe`：双击安装，带开始菜单/桌面快捷方式。CI 每次打 tag 都会发布到 Releases。
- **便携版** `MinCal-<版本>-windows-x64.zip`（免安装，含 `MinCal.exe` + `WebView2Loader.dll` + `libunwind.dll` + 证书与说明）：目前由**本地打包**产出，暂不在 CI/Releases 里；需要的话按下方"本地构建"自行组装。

装好后首次启动，在 **设置** 里填服务器地址，形如 `http://<服务器IP>:28091`。
旧版本里填过的 `:8091` 会在启动时**自动改写**成 `:28091`，不用手动重填。

## 部署后端（任意 Docker 环境）

后端镜像基于 `python:3.12-slim`，**容器内固定监听 8000**，不绑定任何面板或发行版——Docker Engine、Podman、Portainer、任意云主机/VPS 都一样跑。唯一的额外依赖是一个可访问的 **PostgreSQL**（已建好库和账号）。

### 方式一：docker compose（推荐）

```bash
cp .env.example .env            # 填 DATABASE_URL / JWT_SECRET / CORS_ORIGINS
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:28091/health
```

### 方式二：纯 docker run（没装 compose 也能跑）

```bash
docker build -t mincal-server ./backend
docker run -d --name mincal-server \
  -p 28091:8000 \
  -e DATABASE_URL="postgresql+asyncpg://mincal:<强密码>@<PG主机>:5432/mincal" \
  -e JWT_SECRET="<随机串>" \
  -e CORS_ORIGINS="http://localhost,http://127.0.0.1,http://<客户端IP>" \
  --restart unless-stopped \
  mincal-server
```

宿主机端口可换成任意空闲端口（`-p <宿主端口>:8000`）；客户端填的就是这个**宿主端口**。

### 方式三：完全不用 Docker

```bash
cd backend
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 28091
```

### 用 1Panel / 宝塔 / Portainer 之类的面板？

面板只是"帮你执行同一个 compose 文件"的入口，**不用换镜像、不用改端口映射逻辑**。在面板里选「Compose / 容器编排 → 新建项目」，把仓库里的 `docker-compose.yml` 原样贴进去，并保证同目录有 `.env` 即可。面板把项目放在哪个目录由它自己决定，**与能否运行无关**——不要为了迁就面板去改 compose 内容。

### 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | 是 | PostgreSQL 连接串，**必须**是 `postgresql+asyncpg://` 前缀 |
| `JWT_SECRET` | 是 | JWT 签名密钥，用 `openssl rand -hex 32` 生成；改了会使已登录会话失效 |
| `CORS_ORIGINS` | 否 | 允许访问的客户端来源，逗号分隔，默认 `http://localhost,http://127.0.0.1` |

缺 `DATABASE_URL` / `JWT_SECRET` 时 `docker compose up` 会**直接报错退出**，不会拿默认口令悄悄启动（已实测：`required variable DATABASE_URL is missing a value`）。

### 网络与端口

- 服务端口 **28091**（映射到容器内 8000）。部署前确认没被占用：`ss -tlnp | grep 28091`
- 走反向代理（Nginx / Caddy / Traefik）时必须转发 WebSocket：保留 `Upgrade` 与 `Connection: upgrade` 头，并放宽长连接超时，否则实时同步会断
- 健康检查：`GET /health` → `{"status":"ok|degraded","database":"up|down"}`

## 从源码构建客户端（开发者）

### 本机 Windows 构建

```powershell
# Windows 10/11 x64；前置：Rust（rustup，默认 stable）+ Node.js 18+
.\scripts\build-windows.ps1
# 产出：client\src-tauri\target\release\bundle\nsis\MinCal Setup <版本>.exe
```

### CI 构建与发布

流水线：`test-client` + `test-backend` → `build-windows`（构建 + 生产模式防呆校验，产物 `mincal-windows-installer-unsigned`）→ `package`（在 Linux 上用 `osslsigncode` 处理并产出最终包 `mincal-windows-installer`）→ 打 tag 时发布 Release。

**签名是可选的，不会卡住打包**：

| 情况 | 行为 |
| --- | --- |
| 配了签名证书 secrets | 逐个签名 → **强制验签**；验签不过直接失败拦下（坏包绝不外发） |
| 没配 secrets | **照常出包**，只是未签名；Release 正文自动写明"未签名"并给出 sha256 供人工校验 |

也就是说：**任何时候 `git tag` 都能拿到可用安装包**，不配证书也能正常打包使用；配了证书只是让包多一层来源标识。

| 触发方式 | 产出 | 能否直接给用户 |
| --- | --- | --- |
| push 到 `main` / Pull Request | Actions Artifacts：`mincal-windows-installer`（需登录下载、约 90 天过期） | ⚠️ 自测用 |
| 推 `v*` tag | 同一个包发布到 **Releases**（正文自动标注签名状态 + sha256） | ✅ 对外交付走这个 |

发版：

```bash
git tag v0.1.6
git push origin v0.1.6
```

#### （可选）想让包带上签名：一次性配置 Secrets

**不配也完全不影响打包发版**，只是包是未签名的。想启用签名就在仓库
**Settings → Secrets and variables → Actions → Repository secrets** 加两条，流水线会自动切换成签名模式：

| Secret 名 | 值怎么来 |
| --- | --- |
| `MINCAL_CODESIGN_PFX_BASE64` | `base64 -w0 signing/mincal-cs.pfx` 的完整输出 |
| `MINCAL_CODESIGN_PASSWORD` | `cat signing/password.txt` 的口令原文 |

> ⚠️ `.pfx` 与口令文件本身**不要**提交（`.gitignore` 已屏蔽 `signing/*.pfx`、`signing/password.txt`）。流水线里 base64 解码后会清洗空白，所以带不换行/多行格式的 base64 都能用。
>
> 关于 SmartScreen：这是**自签名**证书，用户机器需要先信任那枚根证书（导入"受信任的根证书颁发机构" + "受信任的发布者"）才不弹窗。签名流程本身无法绕过这一点——要彻底消除警告只能购买公共可信的代码签名证书。

## 本地开发

> 在项目根目录执行，不依赖固定安装路径；把 `<...>` 换成你自己的值。

```bash
# 1. 配置
cp .env.example .env      # 填三项，见上面「环境变量」表

# 2. 起后端
docker compose up -d --build
curl http://127.0.0.1:28091/health

# 3. 前端热更新（Vite 开发服务器：127.0.0.1:25173）
cd client && npm install && npm run dev

# 4. 桌面壳调试（需 Rust）
npx tauri dev
```

裸跑后端（不经过 Docker）：`cd backend && pip install -r requirements.txt && uvicorn app.main:app --reload --port 28091`

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
│   ├── Dockerfile     # python:3.12-slim，容器内监听 8000
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
├── .github/workflows/ # CI（Artifacts；打 tag 时发布 Release）
├── scripts/           # 构建脚本
├── docker-compose.yml # 28091:8000，配置从 .env 读
├── .env.example       # 配置样例（.env 不入库）
└── docs/              # PRD.md、部署及使用说明.md、测试用例.md
```
