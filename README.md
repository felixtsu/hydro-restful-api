# HydroOJ REST API

[![License](https://img.shields.io/github/license/felixtsu/hydro-restful-api)](LICENSE)
[![npm version](https://img.shields.io/npm/v/hydrooj-rest-api)](https://www.npmjs.com/package/hydrooj-rest-api)

A read-only RESTful interface for [HydroOJ](https://github.com/hydro-dev/Hydro), enabling seamless remote access via a companion CLI client or any HTTP consumer.

**Source:** [github.com/felixtsu/hydro-restful-api](https://github.com/felixtsu/hydro-restful-api) · Maintainer: **[@felixtsu](https://github.com/felixtsu)**

[English](#english) | [简体中文](#简体中文)

---

## English

### Features

- **Read-only Access**: Securely expose problems, submissions, homework, and contests.
- **JWT Authentication**: Industry-standard token-based security via `POST /rest-api/login`.
- **Companion CLI**: A full-featured Node.js CLI tool for terminal-based OJ interaction.
- **Lightweight Addon**: Runs directly within the HydroOJ process without extra ports.

### Components (two separate deliverables)

| Component | Role | Location |
|-----------|------|----------|
| **Server addon** | Runs **inside** the HydroOJ Node process. Registers **`/rest-api/*`** (read-only data + `POST /rest-api/login` for JWT). **Only the Hydro server** needs this. | `addon/` (npm: [`hydrooj-rest-api`](https://www.npmjs.com/package/hydrooj-rest-api)) |
| **CLI client** | Node.js **18+** tool for **students, teachers, or scripts**. Talks to your site over HTTPS; stores a token under `~/.config/hydrooj_cli/`. Command: **`hydrooj-cli`**. | `cli/ts/` (npm: [`hydrooj-cli`](https://www.npmjs.com/package/hydrooj-cli)) |

These are **two npm packages** with independent versions. Publish or upgrade them separately.

### Quick Start

#### 1. Server Setup (Addon)

**Standard Installation** (from npm):
```bash
# 1) Install into Hydro's home (`~/.hydro`), not globally.
cd ~/.hydro
npm install hydrooj-rest-api

# 2) Register the addon by absolute path (the folder that contains package.json):
ADDON_DIR="$(pwd)/node_modules/hydrooj-rest-api"
hydrooj addon add "$ADDON_DIR"

# 3) Restart HydroOJ after installing the addon.
```

**Development / local install**

1. Clone this repo and link the addon into your Hydro tree (see also [Hydro plugins](https://docs.hydro.ac/docs/Hydro/plugins)):
   ```bash
   cd addon && npm link
   cd /path/to/hydrooj && npm link hydrooj-rest-api
   ```
2. **Security**: Set `JWT_SECRET` (see [Security](#security)).
3. **Restart** HydroOJ.

**CLI from source** (no global publish needed):

```bash
cd cli/ts && npm install && npm run build && npm link
hydrooj-cli help
```

Configure `~/.config/hydrooj_cli/config.json` with `baseUrl` / `base_url`, or set **`HYDRO_API_URL`**. If your site uses `/d/<domain>/` in the browser, include that path in the base URL.

#### 2. Client setup (CLI)

```bash
npm install -g hydrooj-cli
hydrooj-cli login
hydrooj-cli list
```

### Security

The addon uses **JSON Web Tokens (JWT)** for authentication.
- **`JWT_SECRET`**: Must be set in production to prevent token forgery.
- **How to set**: 
  - **Environment Variable**: Set `JWT_SECRET` in your shell or process manager (e.g., `export JWT_SECRET=$(openssl rand -base64 32)`).
  - **Hydro Panel**: After installing the addon, go to **System Settings** -> **Addon Config** -> `hydrooj-rest-api` and enter your `jwtSecret`.
- **After Installation**: You **must restart** the HydroOJ process (e.g., `pm2 restart hydro`) for the secret and the addon to take effect. Verify by visiting `your-site.com/rest-api/problems`; it should return a 401 JSON error instead of a 404 or a standard HTML page.

Generate a secure secret:
```bash
openssl rand -base64 32
```

### Documentation

Detailed API specifications, including all endpoints and parameters, are available in [SPEC.md](SPEC.md).

---

## 简体中文

**源码：** [github.com/felixtsu/hydro-restful-api](https://github.com/felixtsu/hydro-restful-api) · 维护者：**[@felixtsu](https://github.com/felixtsu)**

### 功能特性

- **只读访问**：安全地暴露题目、提交记录、作业和比赛数据。
- **JWT 认证**：通过 `POST /rest-api/login` 提供标准的令牌化安全认证。
- **配套 CLI**：功能完备的 Node.js 命令行工具，支持终端交互。
- **轻量插件**：直接在 HydroOJ 进程内运行，无需额外端口。

### 核心组件（两个独立交付物）

| 组件 | 角色 | 路径 |
|------|------|------|
| **服务端插件** | 跑在 **HydroOJ 的 Node 进程内**，注册 **`/rest-api/*`**（只读数据 + `POST /rest-api/login` 发 JWT）。**只有跑 Hydro 的机器**需要装。 | `addon/`（npm：`hydrooj-rest-api`） |
| **CLI 客户端** | **Node 18+** 终端工具，供学生/教师或脚本使用；令牌存 `~/.config/hydrooj_cli/`。命令：**`hydrooj-cli`**。 | `cli/ts/`（npm：`hydrooj-cli`） |

二者是 **两个 npm 包**，版本可分别发布、升级。

### 快速开始

#### 1. 服务端配置 (Addon)

**标准安装** (从 npm 安装):
```bash
# 1) 进入 Hydro 的 home 目录（`~/.hydro`）安装，不要用 `-g` 全局安装。
cd ~/.hydro
npm install hydrooj-rest-api

# 2) 注册时请使用绝对路径（包含 package.json 的目录）：
ADDON_DIR="$(pwd)/node_modules/hydrooj-rest-api"
hydrooj addon add "$ADDON_DIR"

# 3) 安装完成后请重启 HydroOJ 使插件生效。
```

**本地开发安装**

1. 克隆仓库并把插件链入 Hydro（详见 [Hydro 插件](https://docs.hydro.ac/docs/Hydro/plugins)）：
   ```bash
   cd addon && npm link
   cd /path/to/hydrooj && npm link hydrooj-rest-api
   ```
2. **安全**：配置 `JWT_SECRET`（见 [安全配置](#安全配置)）。
3. **重启** HydroOJ。

**从源码运行 CLI**（无需先发 npm）：

```bash
cd cli/ts && npm install && npm run build && npm link
hydrooj-cli help
```

在 `~/.config/hydrooj_cli/config.json` 中配置 `baseUrl` / `base_url`，或设置环境变量 **`HYDRO_API_URL`**。若站点 URL 带 `/d/某域/`，请写进 base URL。

#### 2. 客户端配置 (CLI)

全局安装：

```bash
npm install -g hydrooj-cli
hydrooj-cli login
hydrooj-cli list
```

### 安全配置

本插件使用 **JWT** 进行身份验证。
- **密钥安全**：在生产环境中必须配置 `JWT_SECRET` 以防令牌伪造。
- **配置方式**：
  - **环境变量**：在 Shell 或进程管理器中设置 `JWT_SECRET`（如 `export JWT_SECRET=$(openssl rand -base64 32)`）。
  - **Hydro 后端面板**：安装插件并重启后，在“系统设置” -> “插件配置” -> `hydrooj-rest-api` 中填入 `jwtSecret`。
- **安装后步骤**：你**必须重启** HydroOJ 进程（如 `pm2 restart hydro`）以使配置生效。可以通过访问 `你的域名/rest-api/problems` 进行验证，若返回 401 JSON 错误则表示插件已成功运行。

生成安全密钥示例：
```bash
openssl rand -base64 32
```

### 接口文档

关于所有端点和参数的详细说明，请参阅 [SPEC.md](SPEC.md)。

---

## Development & publishing

### Publishing to npm (maintainers)

Two packages: **`hydrooj-rest-api`** (`addon/`) and **`hydrooj-cli`** (`cli/ts/`).

1. **Account** — Register at [npmjs.com](https://www.npmjs.com/), then `npm login`. With 2FA enabled, use an [access token](https://docs.npmjs.com/creating-and-viewing-access-tokens) for CI.
2. **Metadata** — In each `package.json`, keep `repository`, `bugs`, and `homepage` accurate (owner **felixtsu**: `https://github.com/felixtsu/hydro-restful-api`).
3. **Version** — Bump `version` (semver) in the package you are releasing before every publish.
4. **CLI** — From `cli/ts/`, `npm publish`. The `prepublishOnly` script runs `npm run build` so `dist/` is up to date. Verify with `npm install -g hydrooj-cli@<version>` and `hydrooj-cli help`.
5. **Addon** — From `addon/`, `npm publish`. On Hydro hosts, install with `cd ~/.hydro && npm install hydrooj-rest-api@<version>` and register via absolute path as in [Quick Start](#english).
6. **Name conflicts** — If an unscoped name is taken, use e.g. `@your-org/hydrooj-rest-api` and publish with `npm publish --access public`.

Hydro’s plugin model is documented under [Plugins](https://docs.hydro.ac/docs/Hydro/plugins).

### Contributing
Contributions are welcome! Please ensure any new API endpoints are documented in `SPEC.md` and supported in the CLI.

---

## License

[MIT](LICENSE) © [felixtsu](https://github.com/felixtsu)
