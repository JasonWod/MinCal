# MinCal — 团队日历同步工具 PRD

> 工作代号：MinCal（Minimal Calendar），可后续更名

---

## 1. 项目概述

### 一句话描述
一款极简美观的 Windows 桌面日历应用，配合自托管 Linux 后端，让团队同事各自管理日程并实时双向同步。

### 问题背景
- 现有方案（Outlook / Google Calendar）要么依赖 SaaS 云端（数据不在自己手上），要么对小型团队来说功能过剩
- 团队内部需要一个轻量、可控、数据自持的日程协作工具
- 所有同事使用 Windows，部署环境为自有 Linux 服务器

### 核心价值
- **极简**：只做日历核心功能，无社交/邮件/待办等冗余
- **自托管**：数据完全在自有服务器上，安全可控
- **双向同步**：每位同事的修改实时同步给所有人
- **美观**：类 Outlook 的现代化日历 UI，干净清爽

### 设计原则
- 桌面原生体验（不是套壳浏览器）
- 启动即用，无注册/激活门槛
- 离线可用：断网时本地操作，恢复后自动同步

---

## 2. 目标用户与场景

### 目标用户
- 同一团队/办公室的 3–20 人（Windows 用户）
- 需要协调会议、共享空闲时间、记录各自工作安排

### 核心场景
1. **个人日程管理**：在自己的日历上添加/编辑/删除事件
2. **团队可见性**：看到同事们的日程（忙/闲状态，或完整详情——按权限）
3. **会议协调**：查看多位同事的空闲时段，找到共同空闲时间
4. **实时同步**：我改了日程，同事端自动更新；反之亦然
5. **重复事件**：每周例会、每日站会等

### 非目标（明确不做）
- 邮件/收件箱功能
- 任务/待办管理（可作为后续插件）
- 移动端（iOS/Android）——当前仅 Windows
- 大型组织（>50 人）的高并发优化
- 与 Google Calendar / Outlook 的第三方同步（v2+）

---

## 3. 核心功能（MVP：托盘弹出层 + 完整窗口）

> **MVP 范围**：托盘弹出层（主交互）+ 完整窗口（辅助管理）。桌面悬浮组件推迟到 v1.1。

### 3.1 日历视图

| 功能 | 说明 |
|------|------|
| 月视图 | 主视图，日历网格，事件以色块/条状显示 |
| 周视图 | 时间轴 + 小时列，事件按时间定位（类 Outlook） |
| 日视图 | 单天时间轴，事件详细展示 |
| 今天高亮 | 当前日期视觉强调 |
| 拖拽调整 | 拖拽事件修改时间/时长 |
| 点击创建 | 点击空白时间区域快速创建事件 |

### 3.2 事件模型

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 全局唯一标识 |
| title | string | 事件标题（必填） |
| description | text | 详细描述（可选） |
| start_time | datetime | 开始时间（UTC 存储，本地时区展示） |
| end_time | datetime | 结束时间 |
| location | string | 地点（可选） |
| attendees | [uuid] | 参与者列表 |
| reminder_min | int? | 提前提醒分钟数 |
| recurrence | RRULE? | 重复规则 |
| color | string | 事件颜色（用户可选） |
| visibility | enum | `private` / `busy` / `public` |
| owner_id | uuid | 创建者 |
| created_at | datetime | 创建时间 |
| updated_at | datetime | 最后修改时间 |
| deleted | bool | 软删除标记 |
| version | bigint | 乐观锁版本号 |

### 3.3 重复事件
- 支持：每天 / 每周（指定星期）/ 每月（指定日期）/ 每 N 周
- 异常处理：跳过某次 / 修改某次（例外）/ 取消后续
- 采用 RRULE（RFC 5545）子集

### 3.4 多用户 & 可见性
- 每位用户有独立日历
- 日历视图中可叠加显示其他同事的事件
- 可见性级别：
  - `private`：仅自己可见
  - `busy`：他人仅看到"忙碌"色块（无标题/详情）← **默认**
  - `public`：他人可见完整信息

### 3.5 搜索 & 过滤
- 按标题/描述/地点搜索
- 按颜色/参与人/日期范围过滤

### 3.6 设置
- 时区选择
- 工作周配置（起始日、工作时段）
- 同步服务器地址
- 登录/账户管理
- 主题：浅色 / 深色

---

## 4. 后续迭代（非 MVP）

| 版本 | 特性 |
|------|------|
| **v1.1** | **桌面悬浮组件**（毛玻璃卡片、可拖拽、always-on-top、非焦点降透明） |
| v1.2 | 系统通知：事件提醒弹窗 |
| v1.3 | iCal / Google Calendar 导入导出 |
| v1.4 | 移动端（Tauri 同构 or 独立） |
| v1.5 | 团队共享日历（多人共同维护一个日历） |
| v1.6 | 开放 API + Webhook（对接内部系统） |
| v2.0 | 待办/任务模块、与项目管理工具集成 |

---

## 5. 技术架构

### 5.1 总体架构

```
┌─────────────────────────────────────────────────────────────┐
│  Windows 客户端 × N (Tauri 2 + React)                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │  日历 UI     │  │  本地 SQLite  │  │  同步引擎    │       │
│  │ (React)      │  │  (离线缓存)   │  │ (HTTP + WSS) │       │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘       │
│         └─────────────────┼─────────────────┘               │
│                           │                                 │
│                 HTTPS / WSS                                 │
└───────────────────────────┼─────────────────────────────────┘
                            │
               ┌────────────┴────────────┐
               │    后端 (Docker)         │
               │  ┌────────────────────┐ │
               │  │  FastAPI + uvicorn │ │  ← REST API + WebSocket
               │  └─────────┬──────────┘ │
               │            │            │
               │  ┌─────────┴──────────┐ │
               │  │   PostgreSQL       │ │  ← 事件存储
               │  │  (100.66.1.1:5432) │ │
               │  └────────────────────┘ │
               │                         │
               │  ┌────────────────────┐ │
               │  │  Redis (可选)      │ │  ← WS 广播 / 会话缓存
               │  └────────────────────┘ │
               └─────────────────────────┘
```

### 5.2 客户端选型：Tauri 2 + React（多窗口混合形态）

**推荐理由：**
- 包体小（~15 MB vs Electron ~150 MB），启动快
- 使用系统 WebView2（Win 10/11 自带），渲染一致性好
- Rust 后端层原生支持 **系统托盘**（SystemTray）、多窗口管理、always-on-top、透明窗口
- React 前端生态成熟
- 保留跨平台能力（未来可编译 Linux/macOS）

**三种窗口形态（共享同一 React 前端 + 同一本地 SQLite）：**

| 窗口 | Tauri 窗口属性 | 尺寸 | 用途 |
|------|---------------|------|------|
| 托盘弹出层 | `decorations: false` + `always_on_top: true` + 锚定托盘 | ~360 × 500 | 主交互面：今日/近几天日程、快速新建 |
| 桌面悬浮组件 | `decorations: false` + `transparent: true` + `always_on_top: true` + `skip_taskbar: true` | ~280 × 360（可调） | 常驻展示：今日日程卡片 |
| 完整窗口 | 标准 decorated window | 自适应（min 1024×700） | 复杂操作：月/周/日视图、事件编辑、设置 |

**交互流转：**
- 托盘左键 → 切换弹出层显示/隐藏
- 托盘右键 → context menu（今天 / 本周 / 显示悬浮组件 / 设置 / 退出）
- 弹出层内 "+ 新建" → 内联快速创建（标题+时间，2 步完成）
- 弹出层内点击事件 → 展开详情 or 打开完整窗口编辑
- 悬浮组件点击事件 → 打开弹出层 / 完整窗口
- 悬浮组件可拖拽、可关闭（托盘菜单重新开启）

**前端日历组件：**
- 弹出层：自绘轻量列表（非 FullCalendar），今天 + 未来 3 天，紧凑
- 完整窗口：**FullCalendar**（月/周/日/拖拽/样式可定制）
- 桌面组件：自绘极简卡片（日期 + 事件列表）

**本地存储：**
- SQLite（via `tauri-plugin-sql`）：离线时本地缓存全部事件
- 启动流程：后台静默同步 → 本地加载 → 有变更则推送
- 三窗口共享同一 SQLite 连接（通过 Tauri command 层访问）

### 5.3 后端选型：FastAPI + PostgreSQL

**理由：**
- 与现有 qsb-studio 技术栈一致（FastAPI / uvicorn）
- 已有 Postgres 实例（100.66.1.1:5432），零额外数据库成本
- async 原生支持 WebSocket
- ORM：SQLAlchemy 2 + Alembic（迁移）

**备选：** Go (Gin/Echo) + Postgres — 性能更好，单二进制部署简单，但开发体验略差

### 5.4 通信协议

| 通道 | 用途 | 协议 |
|------|------|------|
| REST API | 认证、事件 CRUD、初始同步 | HTTPS (JSON) |
| WebSocket | 实时推送增量变更 | WSS |
| 心跳 | 连接保活、断线检测 | WS ping/pong (30 s) |

---

## 6. 数据模型（PostgreSQL）

```sql
-- 用户
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username      VARCHAR(64) UNIQUE NOT NULL,
    password_hash VARCHAR(256) NOT NULL,
    display_name  VARCHAR(128) NOT NULL,
    email         VARCHAR(256),
    timezone      VARCHAR(64) DEFAULT 'Asia/Shanghai',
    color         VARCHAR(7) DEFAULT '#4F46E5',
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now()
);

-- 事件
CREATE TABLE events (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title        VARCHAR(512) NOT NULL,
    description  TEXT,
    start_time   TIMESTAMPTZ NOT NULL,
    end_time     TIMESTAMPTZ NOT NULL,
    location     VARCHAR(512),
    recurrence   TEXT,              -- RRULE string, NULL = non-recurring
    rrule_exdate TEXT[],            -- EXDATE list
    reminder_min INT,
    color        VARCHAR(7),
    visibility   VARCHAR(16) NOT NULL DEFAULT 'busy',
    created_at   TIMESTAMPTZ DEFAULT now(),
    updated_at   TIMESTAMPTZ DEFAULT now(),
    deleted      BOOLEAN NOT NULL DEFAULT FALSE,
    version      BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX idx_events_owner  ON events(owner_id);
CREATE INDEX idx_events_time   ON events(start_time, end_time);
CREATE INDEX idx_events_active ON events(start_time) WHERE NOT deleted;

-- 事件参与者
CREATE TABLE event_attendees (
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status   VARCHAR(16) NOT NULL DEFAULT 'needs_action',
    PRIMARY KEY (event_id, user_id)
);

-- 同步游标
CREATE TABLE sync_cursors (
    user_id        UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    last_event_ver BIGINT NOT NULL DEFAULT 0,
    last_sync_at   TIMESTAMPTZ DEFAULT now()
);

-- 全局事件版本序列
CREATE SEQUENCE event_version_seq;
```

---

## 7. 同步协议（核心设计）

### 7.1 设计哲学
- **事件为粒度**：每个 event 独立版本号，不做大事务
- **增量同步**：客户端只拉取游标之后的变更
- **实时推送**：WebSocket 推送，减少轮询
- **冲突策略**：MVP 用 Last-Write-Wins（基于 `updated_at`）
- **软删除**：删除不物理移除，标记 `deleted=true`，保证全端一致

### 7.2 同步流程

```
┌──────────────────────────────────────────────────────────────┐
│  初始全量同步 (首次登录 / 重置)                                │
│                                                              │
│  Client ──POST /sync/initial──→ Server                       │
│  Server ── 返回所有未删除 events + 全局版本号 ──→ Client      │
│  Client → 写入本地 SQLite, 记录 last_sync_ver                 │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│  增量同步 (常规)                                              │
│                                                              │
│  ① 推送本地修改:                                             │
│     POST /sync/push { changes: [...], base_version }         │
│     Server: 检查版本冲突 → 应用 → 递增全局版本 → 返回结果     │
│                                                              │
│  ② 拉取更新:                                                │
│     GET /sync/pull?since=last_ver                            │
│     Server: 返回 version > last_ver 的 events (含删除)       │
│     Client: 合并到本地, 更新 last_sync_ver                   │
│                                                              │
│  ③ 实时推送 (WebSocket):                                    │
│     Client 建立 WSS 连接                                     │
│     Server 收到任何 push → 广播 {type, event, version}       │
│     给所有已连接客户端                                        │
│     Client 收到 → 合并本地 → UI 自动刷新                     │
└──────────────────────────────────────────────────────────────┘
```

### 7.3 冲突处理（MVP: LWW）
- 同一 event 被两端同时修改 → 比较 `updated_at`，新者赢
- `updated_at` 相同（极端）→ 比 `version`，大者赢
- 输方修改被丢弃，客户端提示"你的修改已被覆盖"
- 后续可升级：字段级 LWW 或 CRDT（Automerge）

### 7.4 离线支持
- 本地修改先写 SQLite，标记 `pending_sync = true`
- 恢复网络后按时间顺序批量 push
- Server 端对批量 push 做事务性处理

### 7.5 断线重连
- WS 断开 → 指数退避重连（1 s → 2 s → 4 s → … max 30 s）
- 重连成功后先 pull 增量（补齐断线期间变更），再恢复 WS
- 心跳超时 90 s 判定断线

---

## 8. API 设计

### 8.1 认证
```
POST /auth/register    → 注册 (username, password, display_name)
POST /auth/login       → 登录，返回 JWT
POST /auth/refresh     → 刷新 token
```
- JWT (HS256)，access 24 h，refresh 30 d

### 8.2 用户
```
GET  /users/me           → 当前用户
PUT  /users/me           → 更新个人信息
GET  /users?visible=1    → 可见用户列表（日历叠加用）
```

### 8.3 事件
```
POST   /events            → 创建
GET    /events            → 查询 (?start=&end=&owner=&visibility=&q=)
GET    /events/{id}       → 获取单个
PUT    /events/{id}       → 更新 (If-Match: version 乐观锁)
DELETE /events/{id}       → 删除 (软删)
```

### 8.4 同步
```
POST /sync/initial        → 全量同步
POST /sync/push           → 推送本地修改
GET  /sync/pull?since=N  → 拉取增量
WSS  /ws/{user_id}       → WebSocket 实时通道
```

### 8.5 WS 消息格式
```json
{
  "type": "event_updated",
  "version": 1234,
  "event": { "id": "uuid", "title": "...", "start_time": "..." },
  "actor": "user_uuid"
}
```
`type`：`event_created` / `event_updated` / `event_deleted` / `event_restored`

---

## 9. UI/UX 规范

### 9.1 整体风格（macOS 设计语言）

**设计基准：macOS Sonoma / Sequoia 视觉语言**

| 维度 | 规范 |
|------|------|
| 字体 | Segoe UI（Windows 上最接近 SF Pro 的无衬线字体）；字重 400/500/600 |
| 字号阶梯 | 12 / 13 / 14 / 16 / 20 / 24 px（UI 密集用小号，标题大号） |
| 圆角 | 按钮/输入 8 px；卡片/弹出层 12 px；pill 按钮 999 px |
| 色彩 | 以中性灰为主（#FAFAFA / #F5F5F7 / #1D1D1F），强调色单色（靛蓝 #4F46E5）；事件色板 6 色：蓝/绿/橙/紫/红/粉 |
| 阴影 | 弹出层：`0 8px 30px rgba(0,0,0,0.12)`；卡片 hover：`0 2px 8px rgba(0,0,0,0.08)` |
| 毛玻璃 | 弹出层/悬浮组件背景：`backdrop-filter: blur(30px) saturate(180%)`；不透明度 75-85% |
| 分割线 | 0.5 px `rgba(0,0,0,0.08)`（深色：`rgba(255,255,255,0.1)`） |
| 动效 | 弹出/收起：200 ms `cubic-bezier(0.25, 0.1, 0.25, 1)`；hover 状态变化：120 ms ease |
| 交互 | 点击/按下的 scale 效果：`transform: scale(0.97)`（macOS button press feel） |
| 分段控件 | 视图切换用 macOS 风格 segmented control（圆角矩形组，选中态白底+阴影） |
| 图标 | 线性图标（16/20 px），stroke 1.5 px，Lucide Icons 或 Phosphor Icons |

**浅色模式色值：**
- 背景：`#F5F5F7`（弹出层）/ `#FFFFFF`（完整窗口）
- 文字主：`#1D1D1F`；次：`#6E6E73`；辅助：`#86868B`
- 分割线：`rgba(0,0,0,0.08)`
- 强调/选中：`#4F46E5`（10% 底色 = `#EEEEFC`）

**深色模式色值：**
- 背景：`#1C1C1E`（弹出层）/ `#000000`（完整窗口）
- 卡片：`#2C2C2E`
- 文字主：`#F5F5F7`；次：`#A1A1A6`
- 分割线：`rgba(255,255,255,0.1)`
- 强调/选中：`#5E5CE6`

### 9.2 托盘弹出层（主交互面，~360 × 500）

```
┌──────────────────────────────────┐
│  10月23日 周五           [×]     │  ← 日期 + 关闭
├──────────────────────────────────┤
│  今天                           │
│  ┌────────────────────────────┐  │
│  │ 09:00  周会        [●蓝]  │  │
│  │ 10:30  客户评审     [●绿]  │  │
│  │ 14:00  1:1 与张明   [●紫]  │  │
│  │ 16:00  Code Review  [●橙]  │  │
│  └────────────────────────────┘  │
│  [+ 快速新建]                     │
├──────────────────────────────────┤
│  明天 (10/24)                    │
│  ┌────────────────────────────┐  │
│  │ 11:00  项目评审             │  │
│  │ 15:00  午餐 - 李华          │  │
│  └────────────────────────────┘  │
├──────────────────────────────────┤
│  10/25 周六                      │
│  ┌────────────────────────────┐  │
│  │ 09:00  健身房               │  │
│  └────────────────────────────┘  │
├──────────────────────────────────┤
│  [📅 完整日历]  [⚙️ 设置]       │  ← 底部操作栏
└──────────────────────────────────┘
```

- 每条事件：时间 + 标题 + 左侧 3 px 颜色条
- 忙碌事件（他人 busy）：灰色背景条，无标题
- 悬停事件：右侧出现 ✏️ / 🗑 图标
- 点击事件：展开为内联详情（描述/地点/参与者）
- 快速新建：点击 → 内联表单（标题 + 开始时间 + 时长），回车保存
- 滚动：超出可视区域可滚动
- 点击外部区域：自动收起

### 9.3 桌面悬浮组件（v1.1，MVP 不做）

> 推迟到 v1.1 迭代。MVP 仅实现托盘弹出层 + 完整窗口。

```
╭────────────────────────────────╮
│  10月23日 周五        [—] [×] │  ← 半透明标题栏，可拖拽
│                                │
│  ● 09:00  周会                 │
│  ● 10:30  客户评审             │
│  ● 14:00  1:1 与张明           │
│  ● 16:00  Code Review          │
│                                │
│  ── 明天 ──                    │
│  ● 11:00  项目评审             │
│  ● 15:00  午餐 - 李华          │
│                                │
│  共 4 项  [展开全部 →]         │
╰────────────────────────────────╯
```

- 背景：毛玻璃（blur + 85% 不透明度），深色/浅色跟随系统
- 半透明，不完全遮挡桌面
- 标题栏可拖拽移动位置
- 点击事件行 → 打开完整窗口编辑
- 点击"展开全部" → 打开完整窗口
- 最小化按钮 → 收起为小图标；关闭 → 隐藏（托盘菜单恢复）
- 非焦点时自动降低不透明度至 60%（减少干扰）

### 9.4 完整窗口（辅助，min 1024 × 700）

```
┌──────────────────────────────────────────────────────────┐
│  MinCal            [🔍 搜索]  [👥 用户]  [⚙️ 设置]        │  ← 顶栏 48 px
├────────┬─────────────────────────────────────────────────┤
│        │  [月] [周] [日]                                  │  ← 视图切换
│ 侧边栏 │  ◄  2026年10月  ►    [今天]  [+ 新建]           │  ← 工具栏
│ 56 px  ├─────────────────────────────────────────────────┤
│        │                                                 │
│ 👤 用户│  日历主区域 (FullCalendar)                      │
│ 👤 用户│                                                 │
│ 👤 用户│                                                 │
│        │                                                 │
│        │                                                 │
├────────┴─────────────────────────────────────────────────┤
│  ● 已同步 (12:03)  |  3 个离线修改待同步                  │  ← 状态栏 24 px
└──────────────────────────────────────────────────────────┘
```

- 与之前设计一致，FullCalendar 全功能
- 从托盘弹出层或悬浮组件的"完整日历"按钮打开
- 关闭后应用仍驻留托盘（不退出）

### 9.5 事件编辑
- **快速编辑**（弹出层内联）：标题 + 时间，2 步
- **完整编辑**（完整窗口内，侧滑面板 or 弹层）：
  - 标题 / 开始/结束时间 / 全天 / 重复 / 地点 / 描述 / 参与者 / 可见性 / 颜色 / 提醒
  - 保存 / 删除

### 9.6 深色模式
- 自动跟随系统主题
- 背景：`#18181B` / 卡片：`#27272A`
- 文字：`#FAFAFA` / `#A1A1AA`
- 弹出层和悬浮组件均支持

---

## 10. 安全

| 层面 | 措施 |
|------|------|
| 传输 | HTTPS (TLS 1.3) + WSS；LAN 内部可先 HTTP，公网必须 TLS |
| 认证 | JWT (HS256, 256 bit secret)；密码 bcrypt 哈希 |
| 授权 | 每 event 请求校验 owner 或 visibility 权限 |
| 限流 | 每用户 100 req/min |
| 输入校验 | 所有字段类型/长度/格式校验（Pydantic） |
| 数据隔离 | 用户仅可见 visibility ≠ private 的他人事件 |

---

## 11. 部署方案

### 11.1 后端 Docker（通用，任意 Docker/Podman 宿主）

镜像基于 `python:3.12-slim`，容器内固定监听 8000，宿主端口自由映射；不依赖任何管理面板。

```yaml
# 仓库根目录 docker-compose.yml（放到任意目录都行，路径无要求）
services:
  mincal-server:
    build: ./backend          # 或直接 image: <你的镜像仓库>/mincal-server:latest
    container_name: mincal-server
    restart: always
    ports:
      - "28091:8000"         # 左侧宿主端口可换成任意空闲端口
    environment:
      - DATABASE_URL=${DATABASE_URL:?}      # 从 .env 注入，不写死在文件里
      - JWT_SECRET=${JWT_SECRET:?}
      - CORS_ORIGINS=${CORS_ORIGINS:-http://localhost,http://127.0.0.1}
    networks:
      - mincal_net
networks:
  mincal_net:
```

- **端口**：宿主侧默认 28091（`ss -tlnp` 确认空闲即可，换别的端口不影响运行）
- **Postgres**：任意主机的 PostgreSQL 13+，`CREATE DATABASE mincal` 并授权账号即可，不绑定特定实例
- **网络**：LAN 直连，或任意内网隧道方案（Tailscale / ZeroTier / FRP 均可）；客户端填写的是宿主可达地址

### 11.2 客户端分发
- Tauri 编译 Windows x64 NSIS 安装包（~15 MB）
- 内部分发：共享链接 / U 盘 / 内网文件
- 自动更新：可选（Tauri updater），初期手动发版

### 11.3 用户首次配置
1. 安装 .exe
2. 首次启动：输入服务器地址（`http://<server>:28091`）
3. 注册 / 登录
4. 进入日历

---

## 12. 里程碑

| 阶段 | 内容 | 预估 |
|------|------|------|
| **M0: 脚手架** | 后端 FastAPI + Docker + PG 建库建表；Tauri 项目初始化 + 基本 UI 骨架 | 2–3 天 |
| **M1: 认证 & CRUD** | 注册/登录 JWT；事件 CRUD API；客户端基本增删改查（本地 SQLite） | 3–5 天 |
| **M2: 同步引擎** | 增量 push/pull + WebSocket 实时推送；多客户端双向同步跑通 | 5–7 天 |
| **M3: 日历 UI 精修** | 托盘弹出层（macOS 风格毛玻璃）；完整窗口 FullCalendar；多用户叠加；深色模式；编辑面板 | 5–7 天 |
| **M4: 打磨 & 发布** | 重复事件；离线支持；错误处理；NSIS 打包分发；内测 | 3–5 天 |
| **v1.1** | 桌面悬浮组件（毛玻璃、可拖拽、always-on-top） | 2–3 天 |
| **合计** | | **~4–6 周**（单人兼职） |

---

## 13. 风险与对策

| 风险 | 影响 | 对策 |
|------|------|------|
| 时区复杂（DST、跨时区） | 时间显示错乱 | MVP 限定同一时区（Asia/Shanghai）；存储 UTC，展示本地 |
| LWW 导致数据丢失 | 修改被覆盖 | 软删除 + 本地保留历史副本；后续加冲突提示/手动合并 |
| WS 在 NAT/代理下不稳定 | 实时性下降 | 自动降级为短轮询 (30 s)；指数退避重连 |
| WebView2 版本差异 | 渲染不一致 | 要求 Win 10 1803+；Tauri 内置检测 |
| PG 单点故障 | 服务不可用 | 利用已有 PG 高可用；客户端离线缓冲保证数据不丢 |
| 团队扩大后性能 | 同步变慢 | 索引 + 分页 pull；后续引入 Redis 做 WS 扇出 |

---

## 14. 项目结构（建议）

```
~/projects/mincal/
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py                # FastAPI entry
│   │   ├── config.py              # env-based settings
│   │   ├── db/
│   │   │   ├── models.py          # SQLAlchemy models
│   │   │   ├── session.py         # async engine
│   │   │   └── migrations/        # Alembic
│   │   ├── auth/
│   │   │   ├── jwt.py
│   │   │   └── router.py
│   │   ├── events/
│   │   │   ├── router.py
│   │   │   ├── schemas.py         # Pydantic
│   │   │   └── service.py
│   │   ├── sync/
│   │   │   ├── router.py          # /sync/*
│   │   │   ├── ws.py              # WebSocket handler
│   │   │   └── engine.py          # versioning, LWW
│   │   └── users/
│   │       ├── router.py
│   │       └── schemas.py
│   ├── Dockerfile
│   ├── docker-compose.yml
│   ├── requirements.txt
│   └── alembic.ini
├── client/
│   ├── src-tauri/
│   │   ├── tauri.conf.json
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── main.rs
│   │       ├── sync.rs            # local sync logic
│   │       └── db.rs              # SQLite
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── Calendar/
│   │   │   │   ├── MonthView.tsx
│   │   │   │   ├── WeekView.tsx
│   │   │   │   ├── DayView.tsx
│   │   │   │   └── EventCard.tsx
│   │   │   ├── EventEditor.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   ├── TopBar.tsx
│   │   │   └── Settings.tsx
│   │   ├── hooks/
│   │   │   ├── useSync.ts
│   │   │   └── useEvents.ts
│   │   ├── stores/
│   │   │   └── eventStore.ts      # Zustand
│   │   └── lib/
│   │       ├── api.ts
│   │       └── types.ts
│   ├── package.json
│   └── vite.config.ts
├── docs/
│   └── PRD.md
└── README.md
```
