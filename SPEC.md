# HydroOJ REST API - Project Specification

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  HydroOJ Server (oj.cubicbird.com)                          │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  hydrooj-rest-api addon (addon/)                     │   │
│  │  - export function apply(ctx) + ctx.Route() (required) │   │
│  │  - Uses ctx.model.* to access Hydro data              │   │
│  │  - Runs inside Hydro's Koa process                    │   │
│  │  - No separate port - uses Hydro's port              │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
                           ▲
                           │ HTTP (Authorization: Bearer <token>)
                           │
┌──────────────────────────────────────────────────────────────┐
│  CLI Client (cli/ts/)                                       │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  index.ts — TypeScript / Node client                 │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

## Project Structure

```
hydrooj_rest_api/
├── addon/                    # HydroOJ addon (server-side)
│   ├── package.json         # npm package config
│   ├── index.ts             # Service + routes (apply entry)
│   └── routes.ts            # Alternate route module (if used)
├── cli/
│   └── ts/
│       └── index.ts         # TypeScript / Node CLI
├── scripts/
│   └── test-rest-addon.sh
├── SPEC.md
└── README.md
```

## Deployment

### Server-side (HydroOJ addon)

1. Copy `addon/` folder to HydroOJ server
2. Place in HydroOJ's addons directory or link via npm
3. Set `JWT_SECRET` environment variable
4. Restart HydroOJ

```bash
# Example: link as npm package
cd /path/to/hydrooj
npm link /path/to/hydrooj_rest_api/addon
# Or git clone directly to addons folder
```

### Client-side (CLI)

```bash
cd cli/ts
npx ts-node index.ts login
npx ts-node index.ts help
```

## API Endpoints

All endpoints mount at `/rest-api/` (not `/api/`, which conflicts with Hydro’s built-in `/api/:op` handler).

### Authentication

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/rest-api/login?username=X&password=Y` | Public | Login, returns token |

### Problems

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/rest-api/problems?page=1&pageSize=20` | Bearer | List problems |
| GET | `/rest-api/problems/:id` | Bearer | Problem details |

### Submissions

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/rest-api/submit` | Bearer | Submit code |
| GET | `/rest-api/submissions?page=1` | Bearer | List submissions |
| GET | `/rest-api/submissions/:id` | Bearer | Submission details |

### Homework vs contests (Hydro)

Hydro uses one contest document type: **homework** has `rule: "homework"`; other rules are **contests**.

### Homework

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/rest-api/homework` | Bearer | List homework |
| GET | `/rest-api/homework/:id` | Bearer | Homework details |
| GET | `/rest-api/homework/:id/problems` | Bearer | Homework problems |
| POST | `/rest-api/homework/:id/register` | Bearer | Register for homework |

### Contests (excluding homework)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/rest-api/contests` | Bearer | List contests (`rule` ≠ `homework`) |
| GET | `/rest-api/contests/:id` | Bearer | Contest details |
| GET | `/rest-api/contests/:id/problems` | Bearer | Contest problems |
| POST | `/rest-api/contests/:id/register` | Bearer | Register for contest |

## Authentication

After login, include the JWT token in requests:

```
Authorization: Bearer <token>
```

## Environment Variables

### Server (addon)
| Variable | Default | Description |
|----------|---------|-------------|
| JWT_SECRET | (dev default) | JWT signing secret |

### Client (CLI)
| Variable | Default | Description |
|----------|---------|-------------|
| HYDRO_API_URL | http://localhost:3000 | HydroOJ API base URL |
