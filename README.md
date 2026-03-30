# HydroOJ REST API

[![License](https://img.shields.io/github/license/felixtsu/hydro-restful-api)](LICENSE)
[![npm version](https://img.shields.io/npm/v/hydrooj-rest-api)](https://www.npmjs.com/package/hydrooj-rest-api)

A read-only RESTful interface for [HydroOJ](https://github.com/hydro-dev/Hydro), enabling seamless remote access via a companion CLI client or any HTTP consumer.

[English](#english) | [简体中文](#简体中文)

---

## English

### Features

- **Read-only Access**: Securely expose problems, submissions, homework, and contests.
- **JWT Authentication**: Industry-standard token-based security via `/rest-api/login`.
- **Companion CLI**: A full-featured Node.js CLI tool for terminal-based OJ interaction.
- **Lightweight Addon**: Runs directly within the HydroOJ process without extra ports.

### Components

| Component | Role | Location |
|-----------|------|----------|
| **Server Addon** | Core service providing REST endpoints. | `addon/` |
| **CLI Client** | Terminal tool for end-users. | `cli/ts/` |

### Quick Start

#### 1. Server Setup (Addon)

1. **Install**: Clone this repository and link it to your HydroOJ installation:
   ```bash
   cd addon && npm link
   cd /path/to/hydrooj && npm link hydrooj-rest-api
   ```
2. **Security**: Set a strong `JWT_SECRET` environment variable (see [Security](#security)).
3. **Restart**: Restart HydroOJ to register the `/rest-api` routes.

#### 2. Client Setup (CLI)

Install globally via npm:
```bash
npm install -g hydrooj-rest-cli
hydrooj-rest login
hydrooj-rest list
```

### Security

The addon uses **JSON Web Tokens (JWT)** for authentication.
- **`JWT_SECRET`**: Must be set in production to prevent token forgery.
- **Configuration**: Use environment variables or Hydro's addon configuration (`jwtSecret`).

Generate a secure secret:
```bash
openssl rand -base64 32
```

### Documentation

Detailed API specifications, including all endpoints and parameters, are available in [SPEC.md](SPEC.md).

---

## 简体中文

### 功能特性

- **只读访问**：安全地暴露题目、提交记录、作业和比赛数据。
- **JWT 认证**：通过 `/rest-api/login` 提供标准的令牌化安全认证。
- **配套 CLI**：功能完备的 Node.js 命令行工具，支持终端交互。
- **轻量插件**：直接在 HydroOJ 进程内运行，无需额外端口。

### 核心组件

| 组件 | 角色 | 路径 |
|------|------|------|
| **服务端插件 (Addon)** | 提供 REST 接口的核心服务。 | `addon/` |
| **命令行客户端 (CLI)** | 面向终端用户的工具。 | `cli/ts/` |

### 快速开始

#### 1. 服务端配置 (Addon)

1. **安装**：拉取仓库并将其链接到你的 HydroOJ 实例：
   ```bash
   cd addon && npm link
   cd /path/to/hydrooj && npm link hydrooj-rest-api
   ```
2. **安全**：设置强随机的 `JWT_SECRET` 环境变量（详见 [安全配置](#安全配置)）。
3. **重启**：重启 HydroOJ 以注册 `/rest-api` 路由。

#### 2. 客户端配置 (CLI)

通过 npm 全局安装：
```bash
npm install -g hydrooj-rest-cli
hydrooj-rest login
hydrooj-rest list
```

### 安全配置

本插件使用 **JWT** 进行身份验证。
- **密钥安全**：在生产环境中必须配置 `JWT_SECRET` 以防令牌伪造。
- **配置方式**：支持环境变量或 Hydro 插件配置项 (`jwtSecret`)。

生成安全密钥示例：
```bash
openssl rand -base64 32
```

### 接口文档

关于所有端点和参数的详细说明，请参阅 [SPEC.md](SPEC.md)。

---

## Development & Publishing

### NPM Publishing
To publish the components independently:

1. **Update Metadata**: Ensure `package.json` in `addon/` and `cli/ts/` has correct repository URLs.
2. **Build CLI**: `cd cli/ts && npm run build`.
3. **Publish**: Run `npm publish` in the respective directories.

### Contributing
Contributions are welcome! Please ensure any new API endpoints are documented in `SPEC.md` and supported in the CLI.

---

## License

[MIT](LICENSE) © [felixtsu](https://github.com/felixtsu)
