# HydroOJ REST API - Project Specification

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  HydroOJ Server (oj.cubicbird.com)                          │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  hydrooj-rest-api addon (addon/)                     │   │
│  │  - Registers REST routes via ctx.Route()             │   │
│  │  - Uses ctx.model.* to access Hydro data              │   │
│  │  - Runs inside Hydro's Koa process                    │   │
│  │  - No separate port - uses Hydro's port              │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
                           ▲
                           │ HTTP (Authorization: Bearer <token>)
                           │
┌──────────────────────────────────────────────────────────────┐
│  CLI Clients (cli/)                                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │ cli/go/     │  │ cli/ts/     │  │ cli/python/ │        │
│  │ main.go     │  │ index.ts    │  │ hydrooj_cli │        │
│  │ (最终交付)   │  │ (备选)      │  │ (已有基础)  │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
└──────────────────────────────────────────────────────────────┘
```

## Project Structure

```
hydrooj_rest_api/
├── addon/                    # HydroOJ addon (server-side)
│   ├── package.json         # npm package config
│   └── index.ts             # Service + routes
├── cli/                     # CLI clients (client-side)
│   ├── go/
│   │   └── main.go          # Go CLI (recommended for final delivery)
│   ├── ts/
│   │   └── index.ts         # TypeScript/Node CLI
│   └── python/
│       └── hydrooj_cli.py   # Python CLI
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

#### Go CLI (Recommended)
```bash
cd cli/go
go build -o hydrooj main.go
./hydrooj login
./hydrooj list
```

#### Python CLI
```bash
python3 cli/python/hydrooj_cli.py login
python3 cli/python/hydrooj_cli.py list
```

#### TypeScript CLI
```bash
cd cli/ts
npx ts-node index.ts login
```

## API Endpoints

All endpoints mount at `/api/` on the HydroOJ server.

### Authentication

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/login?username=X&password=Y` | Public | Login, returns JWT token |

### Problems

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/problems?page=1&pageSize=20` | Bearer | List problems |
| GET | `/api/problems/:id` | Bearer | Problem details |

### Submissions

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/submit` | Bearer | Submit code |
| GET | `/api/submissions?page=1` | Bearer | List submissions |
| GET | `/api/submissions/:id` | Bearer | Submission details |

### Contests

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/contests` | Bearer | List contests |
| GET | `/api/contests/:id` | Bearer | Contest details |
| GET | `/api/contests/:id/problems` | Bearer | Contest problems |
| POST | `/api/contests/:id/register` | Bearer | Register for contest |

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
