# HydroOJ REST API

---

## English

Read-only REST endpoints for HydroOJ, suitable for remote CLI access. `GET /rest-api/login` returns a JWT for authenticated requests. Code submission and contest or homework registration are not provided here; use the web UI or Hydro’s native APIs for those.

### Repository layout

```
addon/           # HydroOJ addon (server-side)
cli/ts/          # TypeScript / Node CLI
```

### Deployment

**Server (addon)**

1. Copy `addon/` onto the HydroOJ server and install or link it like other Hydro addons.
2. Set the `JWT_SECRET` environment variable.
3. Restart HydroOJ.

The addon must expose **`export function apply(ctx, config)`** (and may export `export const Config`). Hydro registers routes from `apply`; a default-export class with instance methods alone will not register `/rest-api/...` routes.

**CLI**

```bash
cd cli/ts && npx ts-node index.ts login
npx ts-node index.ts help
```

See `help` for all commands, including `homework-detail`, `homework-problems`, `contest-detail`, and `contest-problems`.

### API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/rest-api/login?username=X&password=Y` | Login, returns token |
| GET | `/rest-api/problems?page=1&pageSize=20` | List problems |
| GET | `/rest-api/problems/:id` | Problem details |
| GET | `/rest-api/submissions?page=1&pageSize=20` | List submissions |
| GET | `/rest-api/submissions/:id` | Submission status |
| GET | `/rest-api/homework?page=1&pageSize=20` | List homework (`rule: homework`) |
| GET | `/rest-api/homework/:id` | Homework details |
| GET | `/rest-api/homework/:id/problems` | Homework problems |
| GET | `/rest-api/contests?page=1&pageSize=20` | List contests only (`rule` ≠ `homework`) |
| GET | `/rest-api/contests/:id` | Contest details |
| GET | `/rest-api/contests/:id/problems` | Contest problems |

List endpoints support **`page`** and **`pageSize`** (capped at 100). The problems list also supports **`tag`**, **`difficulty`**, and **`keyword`**.

These routes use the `/rest-api` prefix so they do not collide with Hydro’s built-in `/api/:op` handler.

---

## 中文

面向 HydroOJ 的只读 REST 接口，便于远程 CLI 等客户端访问。`GET /rest-api/login` 用于获取 JWT，其它受保护接口在请求头中携带令牌。本题库不提供代码提交以及比赛/作业报名；请使用 Web 端或 Hydro 原生能力完成这些操作。

### 仓库结构

```
addon/           # HydroOJ 插件（服务端）
cli/ts/          # TypeScript / Node CLI
```

### 部署说明

**服务端（插件）**

1. 将 `addon/` 放到 HydroOJ 服务器上，按普通 Hydro 插件方式安装或链接。
2. 配置环境变量 `JWT_SECRET`。
3. 重启 HydroOJ。

插件必须提供 **`export function apply(ctx, config)`**（可选 `export const Config`）。Hydro 通过 `apply` 注册路由；若仅有默认导出的类并把路由写在实例方法上，将无法注册 `/rest-api/...` 路由。

**命令行客户端**

```bash
cd cli/ts && npx ts-node index.ts login
npx ts-node index.ts help
```

运行 `help` 可查看全部子命令，含 `homework-detail`、`homework-problems`、`contest-detail`、`contest-problems`。

### 接口一览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/rest-api/login?username=X&password=Y` | 登录，返回令牌 |
| GET | `/rest-api/problems?page=1&pageSize=20` | 题目列表 |
| GET | `/rest-api/problems/:id` | 题目详情 |
| GET | `/rest-api/submissions?page=1&pageSize=20` | 提交记录列表 |
| GET | `/rest-api/submissions/:id` | 提交状态 |
| GET | `/rest-api/homework?page=1&pageSize=20` | 作业列表（Hydro `rule: homework`） |
| GET | `/rest-api/homework/:id` | 作业详情 |
| GET | `/rest-api/homework/:id/problems` | 作业题目 |
| GET | `/rest-api/contests?page=1&pageSize=20` | 比赛列表（不含 homework 规则） |
| GET | `/rest-api/contests/:id` | 比赛详情 |
| GET | `/rest-api/contests/:id/problems` | 比赛题目 |

列表类接口支持 **`page`**、**`pageSize`**（上限 100）。题目列表另支持 **`tag`**、**`difficulty`**、**`keyword`** 筛选。

接口前缀为 `/rest-api`，避免与 Hydro 内置的 `/api/:op` 冲突。
