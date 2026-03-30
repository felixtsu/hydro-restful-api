# HydroOJ REST API — Specification

---

## English

### Overview

This repository provides a HydroOJ addon that exposes **read-only** HTTP APIs under `/rest-api/`, plus `GET /rest-api/login` to obtain a JWT. A TypeScript CLI under `cli/ts/` can call these APIs. Code submission and contest or homework registration are out of scope; use the web UI or Hydro’s native mechanisms.

### Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  HydroOJ Server                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  hydro-restful-api addon (`addon/`)                  │  │
│  │  - `export function apply(ctx, config)` registers    │  │
│  │    routes via `ctx.Route(...)`                       │  │
│  │  - Uses Hydro’s model layer for data access          │  │
│  │  - Runs inside Hydro’s Koa process; same port        │  │
│  └──────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
                           ▲
                           │ HTTP (`Authorization: Bearer <token>`)
                           │
┌──────────────────────────────────────────────────────────────┐
│  CLI (`cli/ts/`)                                             │
│  │  `index.ts` — TypeScript / Node client                  │  │
└──────────────────────────────────────────────────────────────┘
```

### Repository layout

```
hydrooj_rest_api/
├── addon/
│   ├── package.json
│   ├── index.ts              # Addon entry: `apply`, route registration (loaded by Hydro)
│   └── routes.ts             # Route handlers (parallel module; entry is `index.ts`)
├── cli/ts/
│   ├── package.json          # npm package `hydrooj-rest-cli`, bin `hydrooj-rest`
│   ├── tsconfig.json
│   ├── bin/hydrooj-rest.js   # Launcher → dist/
│   ├── index.ts              # CLI source
│   └── dist/                 # Build output (gitignored); created by `npm run build`
├── scripts/
│   └── test-rest-addon.sh
├── SPEC.md
└── README.md
```

### Deployment

**Server (addon)**

1. Copy `addon/` to the HydroOJ host and install or link it like other Hydro addons.
2. Set `JWT_SECRET` to a strong, random value.
3. Restart HydroOJ.

```bash
cd /path/to/hydrooj
npm link /path/to/hydrooj_rest_api/addon
# or clone/copy the addon into the addons directory per your setup
```

**CLI**

```bash
npm install -g hydrooj-rest-cli   # after publish; or: cd cli/ts && npm run build && npm link
hydrooj-rest login
hydrooj-rest help
```

`help` also documents `homework-detail`, `homework-problems`, `contest-detail`, and `contest-problems` (each takes an id).

### API

All routes are under **`/rest-api/`** (not `/api/`, which is used by Hydro’s built-in `/api/:op` handler).

Except for login, authenticated routes use **GET only** and are read-only. There are no REST endpoints here for submitting code or registering for contests or homework.

#### Authentication

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/rest-api/login?username=X&password=Y` | Public | Returns JWT |

#### Problems

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/rest-api/problems?page=1&pageSize=20` | Bearer | List problems |
| GET | `/rest-api/problems/:id` | Bearer | Problem details |

The problems list also accepts optional filters: **`tag`**, **`difficulty`**, **`keyword`** (same query string).

#### Submissions

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/rest-api/submissions?page=1&pageSize=20` | Bearer | List submissions |
| GET | `/rest-api/submissions/:id` | Bearer | Submission details |

#### Homework vs contests (Hydro)

Hydro stores both in the contest collection: documents with **`rule: "homework"`** are homework; any other `rule` is treated as a contest for listing under `/rest-api/contests`.

#### Homework

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/rest-api/homework?page=1&pageSize=20` | Bearer | List homework |
| GET | `/rest-api/homework/:id` | Bearer | Homework details |
| GET | `/rest-api/homework/:id/problems` | Bearer | Homework problems |

#### Contests (excluding homework)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/rest-api/contests?page=1&pageSize=20` | Bearer | List contests (`rule` ≠ `homework`) |
| GET | `/rest-api/contests/:id` | Bearer | Contest details |
| GET | `/rest-api/contests/:id/problems` | Bearer | Contest problems |

### Using the token after login

```
Authorization: Bearer <token>
```

### Environment variables

**Server (addon)**

| Variable | Description |
|----------|-------------|
| `JWT_SECRET` | Secret used to sign JWTs. **Use a strong random value** on any shared or production instance. |

**CLI**

| Variable | Default | Description |
|----------|---------|-------------|
| `HYDRO_API_URL` | `http://localhost:3000` | Base URL of the HydroOJ site (scheme + host + port). |

---

## 中文

### 概述

本仓库包含一个 HydroOJ 插件，在 **`/rest-api/`** 下提供**只读** HTTP 接口，并通过 `GET /rest-api/login` 签发 JWT。`cli/ts/` 中的 TypeScript 命令行可作为调用示例或客户端。代码提交、比赛与作业报名不在此 REST 范围内，请使用 Web 端或 Hydro 原生流程。

### 架构

```
┌──────────────────────────────────────────────────────────────┐
│  HydroOJ 服务器                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  hydro-restful-api 插件（`addon/`）                   │  │
│  │  - 通过 `export function apply(ctx, config)` 与      │  │
│  │    `ctx.Route(...)` 注册路由                         │  │
│  │  - 经 Hydro 模型层访问数据                           │  │
│  │  - 运行在 Hydro 的 Koa 进程内，共用站点端口          │  │
│  └──────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
                           ▲
                           │ HTTP（`Authorization: Bearer <token>`）
                           │
┌──────────────────────────────────────────────────────────────┐
│  CLI（`cli/ts/`）                                            │
│  │  `index.ts` — TypeScript / Node 客户端                  │  │
└──────────────────────────────────────────────────────────────┘
```

### 仓库结构

```
hydrooj_rest_api/
├── addon/
│   ├── package.json
│   ├── index.ts              # 插件入口：`apply`、路由注册（由 Hydro 加载）
│   └── routes.ts             # 路由处理实现（与 `index.ts` 并列；入口为 `index.ts`）
├── cli/ts/
│   └── index.ts              # 命令行客户端
├── scripts/
│   └── test-rest-addon.sh
├── SPEC.md
└── README.md
```

### 部署

**服务端（插件）**

1. 将 `addon/` 部署到 HydroOJ 所在环境，按常规方式安装或链接插件。
2. 将 `JWT_SECRET` 设为足够长的随机密钥。
3. 重启 HydroOJ。

```bash
cd /path/to/hydrooj
npm link /path/to/hydrooj_rest_api/addon
# 或按你的环境将插件目录放入 addons 等位置
```

**命令行**

```bash
npm install -g hydrooj-rest-cli   # 发布后；或源码：cd cli/ts && npm run build && npm link
hydrooj-rest login
hydrooj-rest help
```

`help` 中亦说明 `homework-detail`、`homework-problems`、`contest-detail`、`contest-problems`（均需传入 id）。

### 接口说明

所有接口挂载在 **`/rest-api/`** 下（不使用 `/api/`，以免与 Hydro 内置的 `/api/:op` 冲突）。

除登录外，需认证的接口均为 **GET** 且只读。本插件不提供通过 REST 提交代码或报名比赛/作业的接口。

#### 认证

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/rest-api/login?username=X&password=Y` | 无需 | 返回 JWT |

#### 题目

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/rest-api/problems?page=1&pageSize=20` | Bearer | 题目列表 |
| GET | `/rest-api/problems/:id` | Bearer | 题目详情 |

题目列表还可选查询参数 **`tag`**、**`difficulty`**、**`keyword`**（与分页参数同一 query）。

#### 提交记录

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/rest-api/submissions?page=1&pageSize=20` | Bearer | 提交列表 |
| GET | `/rest-api/submissions/:id` | Bearer | 提交详情 |

#### 作业与比赛（Hydro 语义）

Hydro 将二者存在同一套「比赛」文档中：字段 **`rule: "homework"`** 表示作业；其余 `rule` 在 `/rest-api/contests` 下列为比赛。

#### 作业

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/rest-api/homework?page=1&pageSize=20` | Bearer | 作业列表 |
| GET | `/rest-api/homework/:id` | Bearer | 作业详情 |
| GET | `/rest-api/homework/:id/problems` | Bearer | 作业题目 |

#### 比赛（不含 homework 规则）

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/rest-api/contests?page=1&pageSize=20` | Bearer | 比赛列表（`rule` ≠ `homework`） |
| GET | `/rest-api/contests/:id` | Bearer | 比赛详情 |
| GET | `/rest-api/contests/:id/problems` | Bearer | 比赛题目 |

### 登录后携带令牌

```
Authorization: Bearer <token>
```

### 环境变量

**服务端（插件）**

| 变量 | 说明 |
|------|------|
| `JWT_SECRET` | 用于签发 JWT 的密钥。**在对外或生产环境中必须使用高强度随机值。** |

**CLI**

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `HYDRO_API_URL` | `http://localhost:3000` | HydroOJ 站点根地址（协议 + 主机 + 端口）。 |
