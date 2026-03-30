# HydroOJ REST API

This repository ships **two separate artifacts**: a **HydroOJ server addon** and a **Node.js CLI**. They are versioned and published independently on npm when you choose to publish.

---

## English

### 1. Two artifacts — what each one is

| Artifact | Path | Role |
|----------|------|------|
| **Server addon** | `addon/` | Runs **inside** the HydroOJ Node process. Registers read-only HTTP routes under **`/rest-api/*`**, issues JWTs via `GET /rest-api/login`, and reads problems, submissions, homework, and contests from Hydro’s models. **Does not** expose code submit or contest/homework registration. |
| **CLI** | `cli/ts/` | Small **Node 18+** client for anyone who has a shell. Calls the same REST API, saves a token under `~/.config/hydrooj_cli/`. Command name: **`hydrooj-rest`**. |

End users of your OJ only need the **CLI** (or any HTTP client). **Only the machine that runs Hydro** needs the **addon**.

---

### 2. Quick install (step by step)

#### A. Hydro server — install the addon

1. **Get the code**  
   - Clone this repo, *or* after you publish: install the npm package `hydrooj-rest-api` (see [Hydro plugins](https://docs.hydro.ac/docs/Hydro/plugins) for how your Hydro version loads plugins).

2. **Link or install into Hydro** (pick one; exact layout depends on your install):
   ```bash
   cd /path/to/hydrooj_rest_api/addon
   npm link
   cd /path/to/your-hydrooj-project   # Hydro app root, see Hydro docs
   npm link hydrooj-rest-api
   ```
   Or copy/symlink the `addon` folder the way your deployment already loads custom addons.

3. **Configure**  
   - Set **`JWT_SECRET`** in the environment (or use addon config `jwtSecret` if your Hydro setup reads it).

4. **Restart** HydroOJ so `export function apply(ctx, config)` runs and routes are registered.

5. **Check**  
   - `GET /rest-api/login` with bad credentials should return **401** JSON, not an HTML 404.

#### JWT_SECRET (server — set this in production)

Login returns a **JWT**; every other `/rest-api/*` call sends it as `Authorization: Bearer …`. The addon **signs and verifies** that token with **`JWT_SECRET`**. If someone learns your secret, they can mint valid tokens for your site.

| Question | Answer |
|----------|--------|
| Do I need to set it? | **Yes**, for any real deployment. If you omit it, the code falls back to a known default string — fine for a quick local try, **unsafe on the internet**. |
| What value? | A long, **random** string (e.g. 32+ random bytes, encoded). Never commit it to git. |
| Where? | Same place you set other Hydro env vars: systemd `Environment=`, Docker `-e`, process manager config, etc. Some installs also accept addon config **`jwtSecret`** — same role as `JWT_SECRET`. |
| If I change it? | All existing tokens become invalid; users must **log in again**. |

Generate one (either is fine):

```bash
openssl rand -base64 32
```

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

#### B. Your laptop — install the CLI

**From npm (after you or someone has published `hydrooj-rest-cli`):**

```bash
npm install -g hydrooj-rest-cli
hydrooj-rest help
```

**From a git clone (development):**

```bash
cd cli/ts
npm install
npm run build
npm link              # optional: puts hydrooj-rest on your PATH
hydrooj-rest help
# or: node bin/hydrooj-rest.js help
```

**Point the CLI at your site:**

- Create `~/.config/hydrooj_cli/config.json`:
  ```json
  { "baseUrl": "https://your-oj.example.com" }
  ```
  If the site uses a domain prefix in URLs, include it, e.g. `https://your-oj.example.com/d/main/`.

- Or set **`HYDRO_API_URL`** to that URL.

Then:

```bash
hydrooj-rest login
hydrooj-rest list
```

---

### 3. Publishing to npm (for maintainers)

**Prerequisites**

1. [Create an npm account](https://www.npmjs.com/signup).
2. Log in locally: `npm login` (with 2FA, use an [access token](https://docs.npmjs.com/creating-and-viewing-access-tokens) for CI).
3. In **`cli/ts/package.json`** and **`addon/package.json`**, replace the placeholder **`OWNER`** in `repository`, `bugs`, and `homepage` with your real GitHub user or organization.

**Package names**

- Addon: **`hydrooj-rest-api`** (`addon/package.json`).
- CLI: **`hydrooj-rest-cli`** (`cli/ts/package.json`).

If a name is already taken on the public registry, switch to a **scoped** name, e.g. `@your-org/hydrooj-rest-api`, and publish with:

```bash
npm publish --access public
```

**Publish the CLI**

```bash
cd cli/ts
npm install
npm run build          # prepublishOnly also runs this on publish
npm publish
```

Sanity check:

```bash
npm install -g hydrooj-rest-cli
hydrooj-rest help
```

**Publish the addon**

```bash
cd addon
npm publish
```

On each Hydro instance, install the version you published (per [Hydro plugin documentation](https://docs.hydro.ac/docs/Hydro/plugins)) — often `npm install hydrooj-rest-api@version` from the Hydro project root, or `npm link` during development.

**Version bumps**

- Use [semver](https://semver.org/): bump `version` in the relevant `package.json` before each publish.
- CLI and addon can be released on different schedules.

---

### 4. API overview

Read-only JSON API under **`/rest-api`**, JWT via **`GET /rest-api/login`**. Details: **`SPEC.md`**.

---

## 中文

### 1. 仓库里的两件东西

| 构件 | 路径 | 作用 |
|------|------|------|
| **服务端插件** | `addon/` | 跑在 **HydroOJ 的 Node 进程里**，注册 **`/rest-api/*`** 只读接口，用 `GET /rest-api/login` 发 JWT，读题目、提交记录、作业、比赛等。**不提供**交代码、报名比赛/作业。 |
| **命令行客户端** | `cli/ts/` | 给本机用的 **Node 18+** 小工具，调同一套 REST，令牌存在 `~/.config/hydrooj_cli/`。命令名：**`hydrooj-rest`**。 |

学生、老师一般只装 **CLI**（或自己写 HTTP 客户端）；**只有跑 Hydro 的服务器**需要装 **插件**。

---

### 2. 快速安装步骤

#### A. Hydro 服务器上装插件

1. 拉取本仓库代码，或发布后从 npm 安装包 **`hydrooj-rest-api`**（具体加载方式见 [Hydro 插件文档](https://docs.hydro.ac/docs/Hydro/plugins)）。
2. 在插件目录 `npm link`，再到 Hydro 工程根目录执行 `npm link hydrooj-rest-api`（或按你现有方式把 `addon` 链进 Hydro）。
3. 配置环境变量 **`JWT_SECRET`**（或通过 Hydro 可读的配置传 `jwtSecret`）。
4. **重启** HydroOJ。
5. 用错误账号访问 `GET /rest-api/login` 应返回 **401** JSON。

#### JWT_SECRET（服务端 — 生产环境务必配置）

登录接口返回 **JWT**，其它 `/rest-api/*` 请求用 `Authorization: Bearer …` 携带。插件用 **`JWT_SECRET` 签发并校验**令牌。泄露该密钥等于别人可以伪造合法登录态。

| 问题 | 说明 |
|------|------|
| 要不要设？ | **要。** 正式对外或多人使用时必须设置。若不设，代码会使用内置默认字符串，仅适合本机试跑，**公网不可用**。 |
| 设成什么？ | **随机、足够长**的密钥（例如 32 字节随机再编码）。不要写进仓库。 |
| 设在哪里？ | 与 Hydro 其它环境变量相同：systemd `Environment=`、Docker `-e`、进程管理器配置等。部分部署也可在插件配置里写 **`jwtSecret`**，与 `JWT_SECRET` 作用相同。 |
| 更换会怎样？ | 旧令牌全部失效，用户需 **重新登录**。 |

生成示例（任选其一）：

```bash
openssl rand -base64 32
```

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

#### B. 本机装 CLI

**已发布到 npm 时：**

```bash
npm install -g hydrooj-rest-cli
hydrooj-rest help
```

**从源码：**

```bash
cd cli/ts && npm install && npm run build && npm link
hydrooj-rest help
```

配置 `~/.config/hydrooj_cli/config.json` 里的 **`baseUrl` / `base_url`**，或环境变量 **`HYDRO_API_URL`**（若站点 URL 带 `/d/某域/`，请写进 base URL）。

---

### 3. 发布到 npm（维护者）

1. 注册并 `npm login`；若开启 2FA，CI 可用 [access token](https://docs.npmjs.com/creating-and-viewing-access-tokens)。
2. 把 **`addon/package.json`** 和 **`cli/ts/package.json`** 里的 **`OWNER`** 改成真实 GitHub 地址。
3. **CLI**：`cd cli/ts && npm publish`（发布前会自动 `npm run build`）。
4. **插件**：`cd addon && npm publish`。
5. 若包名被占用，改用作用域包名，例如 `@你的组织/hydrooj-rest-api`，并执行 `npm publish --access public`。
6. 每次发布前在对应 `package.json` 里递增 **`version`**（语义化版本）。

接口说明见 **`SPEC.md`**。
