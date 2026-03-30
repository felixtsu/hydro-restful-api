/**
 * HydroOJ CLI - TypeScript/Node.js client for HydroOJ REST API addon
 */
import * as readline from 'readline';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';

interface Config {
  baseUrl: string;
}

interface Session {
  token: string;
}

const CONFIG_DIR = path.join(os.homedir(), '.config', 'hydrooj_cli');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const SESSION_FILE = path.join(CONFIG_DIR, 'session.json');

/** Join base (may include path e.g. https://host/d/main/) with /rest-api/... without dropping the path prefix. */
function resolveApiUrl(baseUrl: string, apiPath: string): URL {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  const baseForJoin = `${trimmed}/`;
  const rel = apiPath.replace(/^\/+/, '');
  return new URL(rel, baseForJoin);
}

function loadConfig(): string {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
      const u = (data.baseUrl || data.base_url || '').trim();
      if (u) return u;
    }
  } catch {}
  return (process.env.HYDRO_API_URL || 'http://localhost:3000').trim();
}

function loadSession(): string | null {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      const data: Session = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
      return data.token || null;
    }
  } catch {}
  return null;
}

function saveSession(token: string): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(SESSION_FILE, JSON.stringify({ token }), { mode: 0o600 });
}

function requireToken(token: string | null): string {
  if (!token) {
    console.error('Not logged in. Run "hydrooj-rest login" first.');
    process.exit(1);
  }
  return token;
}

function apiRequest(baseUrl: string, apiPath: string, method: string = 'GET', body?: object, token?: string | null): Promise<any> {
  return new Promise((resolve, reject) => {
    let url: URL;
    try {
      url = resolveApiUrl(baseUrl, apiPath);
    } catch (e: any) {
      reject(new Error(`Invalid base URL "${baseUrl}": ${e?.message || e}`));
      return;
    }

    if (method === 'GET' && body) {
      for (const [key, value] of Object.entries(body)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;
    const sendJsonBody = method !== 'GET' && body !== undefined;

    const options: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 3000),
      path: url.pathname + url.search,
      method,
      headers: {
        ...(sendJsonBody ? { 'Content-Type': 'application/json' } : {}),
        'Accept': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      timeout: 30000,
    };

    let settled = false;
    const safeResolve = (v: any) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    const safeReject = (err: Error) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    };

    const req = lib.request(options, (res: http.IncomingMessage) => {
      let data = '';
      res.on('data', (chunk: Buffer | string) => {
        data += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      });
      res.on('end', () => {
        const status = res.statusCode ?? 0;
        const raw = data.trim();
        if (!raw) {
          safeReject(new Error(`Empty response body (HTTP ${status})`));
          return;
        }
        let json: any;
        try {
          json = JSON.parse(raw);
        } catch {
          safeReject(new Error(`HTTP ${status}, expected JSON, got: ${raw.slice(0, 240)}${raw.length > 240 ? '...' : ''}`));
          return;
        }
        if (status >= 400) {
          const detail = [json.message, json.error].filter(Boolean).join(' — ') || JSON.stringify(json);
          safeReject(new Error(`HTTP ${status}: ${detail}`));
        } else {
          safeResolve(json);
        }
      });
    });

    req.on('error', (e: Error) => safeReject(e instanceof Error ? e : new Error(String(e))));
    req.on('timeout', () => {
      req.destroy();
      safeReject(new Error('Request timed out after 30s'));
    });

    if (sendJsonBody && body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function login(baseUrl: string): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const question = (q: string): Promise<string> => new Promise((r) => rl.question(q, r));

  const username = await question('Username: ');
  const password = await question('Password: ');
  rl.close();

  try {
    const data = await apiRequest(baseUrl, '/rest-api/login', 'GET', { username, password });
    if (data.token) {
      saveSession(data.token);
      console.log(`Logged in as ${data.uname} (uid=${data.uid})`);
    } else {
      console.error('Login failed: response had no token:', JSON.stringify(data));
      process.exit(1);
    }
  } catch (err: any) {
    const msg = err?.message ?? (err != null ? String(err) : 'unknown error');
    console.error('Login failed:', msg);
    try {
      const sample = resolveApiUrl(baseUrl, '/rest-api/login');
      sample.searchParams.set('username', '...');
      sample.searchParams.set('password', '...');
      console.error('Login URL shape (credentials redacted):', sample.href);
    } catch {
      console.error('Config base URL:', baseUrl);
    }
    console.error(`Check ${CONFIG_FILE} (baseUrl or base_url) or env HYDRO_API_URL. If the site uses /d/<domain>/ in the browser, include that path in the base URL (with trailing slash).`);
    process.exit(1);
  }
}

async function listProblems(baseUrl: string, token: string, args: any): Promise<void> {
  const params = new URLSearchParams({ page: '1', pageSize: '20', ...args });
  const data = await apiRequest(baseUrl, `/rest-api/problems?${params}`, 'GET', undefined, token);

  console.log(`\nProblems (Total: ${data.total})`);
  console.log(`Page ${data.page}/${data.totalPages}\n`);

  for (const p of data.items) {
    const tags = (p.tag || []).join(', ');
    console.log(`  [${p.pid}] ${p.title} (Difficulty: ${p.difficulty}, Tags: ${tags})`);
  }
}

async function showProblem(baseUrl: string, token: string, id: string): Promise<void> {
  const data = await apiRequest(baseUrl, `/rest-api/problems/${id}`, 'GET', undefined, token);

  console.log(`\n#${data.pid}: ${data.title}`);
  console.log(`Difficulty: ${data.difficulty}`);
  console.log(`Tags: ${(data.tag || []).join(', ')}`);
  console.log(`Time Limit: ${data.timeLimit || 1000}ms`);
  console.log(`Memory Limit: ${data.memoryLimit || 256}MB`);
  console.log(`AC/Submit: ${data.accepted || 0}/${data.submission || 0}`);
  console.log(`\n${data.content || 'No description'}`);

  if (data.samples && data.samples.length) {
    console.log('\nSamples:');
    data.samples.forEach((s: any, i: number) => {
      console.log(`\nSample ${i + 1}:`);
      console.log(`  Input: ${s.input}`);
      console.log(`  Output: ${s.output}`);
    });
  }
}

async function showStatus(baseUrl: string, token: string, id?: string): Promise<void> {
  if (!id) {
    const data = await apiRequest(baseUrl, '/rest-api/submissions?page=1&pageSize=20', 'GET', undefined, token);
    console.log('\nRecent Submissions');
    for (const s of data.items) {
      console.log(`  [${s.id}] #${s.pid} - ${s.status} (${s.score}%)`);
    }
  } else {
    const data = await apiRequest(baseUrl, `/rest-api/submissions/${id}`, 'GET', undefined, token);
    console.log(`\nSubmission #${data.id}`);
    console.log(`Problem: #${data.pid}`);
    console.log(`Status: ${data.status}`);
    console.log(`Score: ${data.score}%`);
    console.log(`Time: ${data.time}ms`);
    console.log(`Memory: ${data.memory}KB`);
    console.log(`Language: ${data.language}`);
  }
}

async function listHomework(baseUrl: string, token: string): Promise<void> {
  const data = await apiRequest(baseUrl, '/rest-api/homework?page=1&pageSize=20', 'GET', undefined, token);

  console.log(`\nHomework (Total: ${data.total})`);
  for (const c of data.items) {
    console.log(`  [${c.id}] ${c.title} (${c.status})`);
  }
}

async function listContests(baseUrl: string, token: string): Promise<void> {
  const data = await apiRequest(baseUrl, '/rest-api/contests?page=1&pageSize=20', 'GET', undefined, token);

  console.log(`\nContests (Total: ${data.total})`);
  for (const c of data.items) {
    console.log(`  [${c.id}] ${c.title} (${c.status})`);
  }
}

function formatContestLike(label: string, data: any): void {
  console.log(`\n${label} [${data.id}]: ${data.title}`);
  console.log(`Rule: ${data.rule}  Status: ${data.status}`);
  console.log(`Start: ${data.startAt}  End: ${data.endAt}`);
  if (data.description) console.log(`\n${data.description}`);
  const pids = data.problems || [];
  if (pids.length) console.log(`\nProblem ids (pids): ${pids.join(', ')}`);
}

async function homeworkDetail(baseUrl: string, token: string, id: string): Promise<void> {
  const data = await apiRequest(baseUrl, `/rest-api/homework/${id}`, 'GET', undefined, token);
  formatContestLike('Homework', data);
}

async function homeworkProblems(baseUrl: string, token: string, id: string): Promise<void> {
  const data = await apiRequest(baseUrl, `/rest-api/homework/${id}/problems`, 'GET', undefined, token);
  console.log(`\nHomework problems (${(data.items || []).length})`);
  for (const p of data.items || []) {
    console.log(`  [#${p.pid}] ${p.title}`);
  }
}

async function contestDetail(baseUrl: string, token: string, id: string): Promise<void> {
  const data = await apiRequest(baseUrl, `/rest-api/contests/${id}`, 'GET', undefined, token);
  formatContestLike('Contest', data);
}

async function contestProblems(baseUrl: string, token: string, id: string): Promise<void> {
  const data = await apiRequest(baseUrl, `/rest-api/contests/${id}/problems`, 'GET', undefined, token);
  console.log(`\nContest problems (${(data.items || []).length})`);
  for (const p of data.items || []) {
    console.log(`  [#${p.pid}] ${p.title}`);
  }
}

function printHelp(): void {
  console.log(`HydroOJ REST CLI (TypeScript)

Usage:
  hydrooj-rest <command> [args]
  (after: npm install -g hydrooj-rest-cli)

Dev / from source:
  cd cli/ts && npm run build && node bin/hydrooj-rest.js <command> [args]

Commands:
  login                 Sign in; token is saved for later commands
  list                  List problems (first page, pageSize 20)
  show <id>             Print problem statement and samples
  status [submissionId] Recent submissions, or one submission detail
  homework              List homework (Hydro rule=homework)
  homework-detail <id>  Homework metadata (not full problem statements)
  homework-problems <id>  Problems in a homework
  contests              List contests only (excludes homework)
  contest-detail <id>   Contest metadata
  contest-problems <id> Problems in a contest

REST endpoints (reference; list routes accept page, pageSize; problems list also tag, difficulty, keyword):
  /rest-api/login?username=&password=
  /rest-api/problems?page=&pageSize=&tag=&difficulty=&keyword=
  /rest-api/problems/:id
  /rest-api/submissions?page=&pageSize=
  /rest-api/submissions/:id
  /rest-api/homework?page=&pageSize=
  /rest-api/homework/:id
  /rest-api/homework/:id/problems
  /rest-api/contests?page=&pageSize=
  /rest-api/contests/:id
  /rest-api/contests/:id/problems

Help:
  help, -h, --help      Show this text

Config:
  ${CONFIG_FILE}
    baseUrl or base_url — site root, e.g. https://oj.example.com
                          or https://oj.example.com/d/<domain>/ if URLs use /d/...
  ${SESSION_FILE}
    Written by login (Bearer token)

Environment:
  HYDRO_API_URL         Used when config has no base URL
  HYDRO_CLI_DEBUG=1     Verbose errors (if implemented for a command)
`);
}

async function main() {
  const baseUrl = loadConfig();
  const token = loadSession();

  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd) {
    printHelp();
    process.exit(1);
  }
  if (cmd === 'help' || cmd === '-h' || cmd === '--help') {
    printHelp();
    process.exit(0);
  }

  switch (cmd) {
    case 'login':
      await login(baseUrl);
      break;
    case 'list':
      await listProblems(baseUrl, requireToken(token), {});
      break;
    case 'show':
      if (!args[1]) { console.error('Usage: hydrooj-rest show <problem_id>'); process.exit(1); }
      await showProblem(baseUrl, requireToken(token), args[1]);
      break;
    case 'status':
      await showStatus(baseUrl, requireToken(token), args[1]);
      break;
    case 'homework':
      await listHomework(baseUrl, requireToken(token));
      break;
    case 'contests':
      await listContests(baseUrl, requireToken(token));
      break;
    case 'homework-detail':
      if (!args[1]) { console.error('Usage: hydrooj-rest homework-detail <homework_id>'); process.exit(1); }
      await homeworkDetail(baseUrl, requireToken(token), args[1]);
      break;
    case 'homework-problems':
      if (!args[1]) { console.error('Usage: hydrooj-rest homework-problems <homework_id>'); process.exit(1); }
      await homeworkProblems(baseUrl, requireToken(token), args[1]);
      break;
    case 'contest-detail':
      if (!args[1]) { console.error('Usage: hydrooj-rest contest-detail <contest_id>'); process.exit(1); }
      await contestDetail(baseUrl, requireToken(token), args[1]);
      break;
    case 'contest-problems':
      if (!args[1]) { console.error('Usage: hydrooj-rest contest-problems <contest_id>'); process.exit(1); }
      await contestProblems(baseUrl, requireToken(token), args[1]);
      break;
    default:
      console.error(`Unknown command: ${cmd}`);
      console.error('Run with help, -h, or --help for usage.');
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('Error:', err?.message ?? err);
  process.exit(1);
});
