# HydroOJ REST API

Exposes **read-only** REST endpoints from HydroOJ for remote CLI access (plus `GET /rest-api/login` to obtain a token). Submitting code and contest/homework registration are not exposed here; use the web UI or Hydro’s native APIs for those.

## Structure

```
addon/           # HydroOJ addon (server-side)
cli/ts/          # TypeScript / Node CLI
```

## Deployment

### Server (addon)

1. Copy `addon/` to HydroOJ server
2. Link or npm install in HydroOJ's plugin directory
3. Set `JWT_SECRET` env var
4. Restart HydroOJ

Addon 入口必须是 **`export function apply(ctx, config)`**（并可选 `export const Config`）。仅 `export default class …` 且把路由写在实例方法里时，Hydro 不会执行该方法，路由不会注册（表现为 `/rest-api/...` 全部 `NotFoundError`）。

### CLI

```bash
cd cli/ts && npx ts-node index.ts login
npx ts-node index.ts help
```

## API Endpoints

- `GET /rest-api/login?username=X&password=Y` - Login
- `GET /rest-api/problems?page=1` - List problems
- `GET /rest-api/problems/:id` - Problem details
- `GET /rest-api/submissions` - List submissions
- `GET /rest-api/submissions/:id` - Submission status
- `GET /rest-api/homework` - List homework (Hydro `rule: homework`)
- `GET /rest-api/homework/:id` - Homework details
- `GET /rest-api/homework/:id/problems` - Homework problems
- `GET /rest-api/contests` - List contests only (`rule` ≠ `homework`)
- `GET /rest-api/contests/:id` - Contest details

（使用 `/rest-api` 而非 `/api`，避免与 Hydro 内置 `/api/:op` 冲突。）
