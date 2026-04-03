# HydroOJ REST API

Exposes REST API endpoints from HydroOJ for remote CLI access.

## Structure

```
addon/           # HydroOJ addon (server-side)
cli/
  go/            # Go CLI (recommended)
  ts/            # TypeScript CLI
  python/        # Python CLI
```

## Deployment

### Server (addon)

1. Copy `addon/` to HydroOJ server
2. Link or npm install in HydroOJ's plugin directory
3. Set `JWT_SECRET` env var
4. Restart HydroOJ

### CLI

**Go (recommended):**
```bash
cd cli/go && go build -o hydrooj main.go
./hydrooj login
```

**Python:**
```bash
python3 cli/python/hydrooj_cli.py login
```

**TypeScript:**
```bash
cd cli/ts && npx ts-node index.ts login
```

## API Endpoints

- `GET /api/login?username=X&password=Y` - Login
- `GET /api/problems?page=1` - List problems
- `GET /api/problems/:id` - Problem details
- `POST /api/submit` - Submit code
- `GET /api/submissions` - List submissions
- `GET /api/submissions/:id` - Submission status
- `GET /api/contests` - List contests
- `GET /api/contests/:id` - Contest details
- `POST /api/contests/:id/register` - Register
