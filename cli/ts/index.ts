/**
 * HydroOJ CLI - TypeScript/Node.js client for HydroOJ REST API addon
 */
import * as readline from 'readline';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import FormData from 'form-data';

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

function readConfigFileBaseUrl(): string | null {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
      const u = (data.baseUrl || data.base_url || '').trim();
      if (u) return u;
    }
  } catch {}
  return null;
}

function loadConfig(): string {
  const fromFile = readConfigFileBaseUrl();
  if (fromFile) return fromFile;
  return (process.env.HYDRO_API_URL || '').trim();
}

function loadConfigWithSource(): { baseUrl: string; source: string } {
  const fromFile = readConfigFileBaseUrl();
  if (fromFile) return { baseUrl: fromFile, source: `file (${CONFIG_FILE})` };
  const fromEnv = (process.env.HYDRO_API_URL || '').trim();
  if (fromEnv) return { baseUrl: fromEnv, source: 'environment (HYDRO_API_URL)' };
  return {
    baseUrl: '',
    source: 'not set — run: hydrooj-cli config base-url <url> or set HYDRO_API_URL',
  };
}

function requireBaseUrl(baseUrl: string): string {
  const u = baseUrl.trim();
  if (!u) {
    console.error('No base URL configured. This CLI only works against a Hydro site that has the hydrooj-rest-api server addon installed.');
    console.error('Set your OJ site root, for example:');
    console.error('  hydrooj-cli config base-url https://your-oj.example.com');
    console.error('Or set the environment variable HYDRO_API_URL.');
    console.error('If the site uses /d/<domain>/ in the browser, include that path in the URL.');
    process.exit(1);
  }
  return u;
}

/** True when failure often means wrong host, no /rest-api route, or addon not loaded (not e.g. bad password). */
function isLikelyMissingAddonOrMisconfigured(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (/HTTP 401|HTTP 403\b/.test(msg)) return false;
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|getaddrinfo/i.test(msg)) return true;
  if (/HTTP 404\b/.test(msg)) return true;
  if (/expected JSON/i.test(msg)) return true;
  if (/Empty response body/i.test(msg)) return true;
  if (/HTTP 502|HTTP 503|HTTP 504\b/.test(msg)) return true;
  return false;
}

function printAddonHintIfNeeded(err: unknown): void {
  if (!isLikelyMissingAddonOrMisconfigured(err)) return;
  console.error('');
  console.error('If the URL is correct, the server may be missing the hydrooj-rest-api addon (or it needs a restart).');
  console.error('A working install should serve JSON from POST /rest-api/login (not HTML 404).');
}

function saveConfigBaseUrl(url: string): void {
  const trimmed = url.trim();
  try {
    new URL(trimmed);
  } catch {
    throw new Error(`Invalid base URL: ${JSON.stringify(trimmed)}`);
  }
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  let existing: Record<string, unknown> = {};
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      existing = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    }
  } catch {
    existing = {};
  }
  delete existing.base_url;
  existing.baseUrl = trimmed;
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(existing, null, 2) + '\n', { mode: 0o600 });
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
    console.error('Not logged in. Run "hydrooj-cli login" first.');
    process.exit(1);
  }
  return token;
}

async function questionHidden(prompt: string): Promise<string> {
  const stdin = process.stdin;
  const stdout = process.stdout;

  // If not running in a real terminal (stdin piped), we can't reliably hide echo.
  if (!stdin.isTTY) {
    return await new Promise((resolve) => {
      const rl = readline.createInterface({ input: stdin, output: stdout });
      rl.question(prompt, (ans) => {
        rl.close();
        resolve(ans);
      });
    });
  }

  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();

  return await new Promise<string>((resolve) => {
    let password = '';
    let cleanedUp = false;

    function cleanup(onData: (data: Buffer) => void) {
      if (cleanedUp) return;
      cleanedUp = true;
      try {
        stdin.off('data', onData);
      } catch {}
      try {
        stdin.setRawMode(false);
      } catch {}
      try {
        stdin.pause();
      } catch {}
    }

    const onData = (data: Buffer) => {
      const s = data.toString('utf8');

      // Enter
      if (s === '\r' || s === '\n') {
        cleanup(onData);
        stdout.write('\n');
        resolve(password);
        return;
      }

      // Ctrl-C
      if (s === '\u0003') {
        cleanup(onData);
        process.exit(130);
        return;
      }

      // Backspace/Delete
      if (s === '\u007f' || s === '\b') {
        if (password.length > 0) {
          password = password.slice(0, -1);
          // Remove one '*' from the screen.
          stdout.write('\b \b');
        }
        return;
      }

      // Ignore escape sequences (arrow keys, etc.)
      if (s.startsWith('\u001b')) return;

      // Most passwords are ASCII; for other chars, treat each keypress as 1 char.
      password += s;
      stdout.write('*'.repeat(Array.from(s).length || 1));
    };

    stdin.on('data', onData);
  });
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

async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readJsonWritePayloadAsync(argsAfterCmd: string[]): Promise<object> {
  if (!argsAfterCmd.length) {
    throw new Error('Expected --json, --file, or --stdin as the first option after the command');
  }
  const mode = argsAfterCmd[0];
  if (mode === '--json') {
    const raw = argsAfterCmd[1];
    if (raw === undefined) {
      throw new Error('Usage: hydrooj-cli <contest-create|homework-create|training-create> --json <json-string>');
    }
    return JSON.parse(raw) as object;
  }
  if (mode === '--file') {
    const fp = argsAfterCmd[1];
    if (!fp) {
      throw new Error('Usage: hydrooj-cli <contest-create|homework-create|training-create> --file <path>');
    }
    return JSON.parse(fs.readFileSync(fp, 'utf8')) as object;
  }
  if (mode === '--stdin') {
    const raw = await readAllStdin();
    if (!raw.trim()) throw new Error('Empty stdin');
    return JSON.parse(raw) as object;
  }
  throw new Error(`Expected --json, --file, or --stdin as the first option after the command; got ${mode}`);
}

function apiMultipartRequest(
  baseUrl: string,
  apiPath: string,
  token: string,
  zipPath: string,
): Promise<any> {
  return new Promise((resolve, reject) => {
    let url: URL;
    try {
      url = resolveApiUrl(baseUrl, apiPath);
    } catch (e: any) {
      reject(new Error(`Invalid base URL "${baseUrl}": ${e?.message || e}`));
      return;
    }

    const form = new FormData();
    form.append('zip', fs.createReadStream(zipPath), { filename: path.basename(zipPath) || 'problem.zip' });

    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;
    const headers: http.OutgoingHttpHeaders = {
      ...form.getHeaders(),
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
    };
    const options: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 3000),
      path: url.pathname + url.search,
      method: 'POST',
      headers,
      timeout: 600000,
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
      safeReject(new Error('Request timed out'));
    });
    form.on('error', (e: Error) => safeReject(e));
    form.pipe(req);
  });
}

async function login(baseUrl: string): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const question = (q: string): Promise<string> => new Promise((r) => rl.question(q, r));

  const username = await question('Username: ');
  const password = await questionHidden('Password: ');
  rl.close();

  try {
    const data = await apiRequest(baseUrl, '/rest-api/login', 'POST', { username, password });
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
      console.error('Login endpoint (POST JSON body, credentials omitted):', sample.href);
    } catch {
      console.error('Config base URL:', baseUrl);
    }
    console.error(`Check ${CONFIG_FILE} (baseUrl or base_url), env HYDRO_API_URL, and that the base URL includes /d/<domain>/ if your site uses it.`);
    printAddonHintIfNeeded(err);
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

First-time setup (your Hydro server needs the hydrooj-rest-api addon):
  hydrooj-cli config base-url https://your-oj.example.com

Usage:
  hydrooj-cli <command> [args]
  (after: npm install -g hydrooj-cli)

Dev / from source:
  cd cli/ts && npm run build && node bin/hydrooj-cli.js <command> [args]

Commands:
  config                Show effective base URL and where it comes from
  config base-url <url> Save base URL to ${path.basename(CONFIG_DIR)}/config.json
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
  problem-upload <zipPath>  POST multipart zip to /rest-api/problems (ICPC package)
  contest-create        POST JSON to /rest-api/contests; first flag must be one of:
                          --json <json-string> | --file <path> | --stdin
  homework-create       POST JSON to /rest-api/homework; same --json | --file | --stdin
  training-create       POST JSON to /rest-api/trainings; same --json | --file | --stdin

Help:
  help, -h, --help      Show this text

Config:
  ${CONFIG_FILE}
    baseUrl or base_url — required before login/API use: your OJ site root, e.g. https://oj.example.com
                          or https://oj.example.com/d/<domain>/ if URLs use /d/...
    The server must have the hydrooj-rest-api addon installed.
  ${SESSION_FILE}
    Written by login (Bearer token)

Environment:
  HYDRO_API_URL         Base URL when the config file does not set baseUrl / base_url
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

  const COMMANDS_NEEDING_BASE = new Set([
    'login',
    'list',
    'show',
    'status',
    'homework',
    'contests',
    'homework-detail',
    'homework-problems',
    'contest-detail',
    'contest-problems',
    'problem-upload',
    'contest-create',
    'homework-create',
    'training-create',
  ]);
  const apiBase = COMMANDS_NEEDING_BASE.has(cmd) ? requireBaseUrl(baseUrl) : '';

  switch (cmd) {
    case 'config': {
      const sub = args[1];
      if (sub === 'base-url' || sub === 'base_url') {
        const url = args[2];
        if (!url) {
          console.error('Usage: hydrooj-cli config base-url <url>');
          process.exit(1);
        }
        try {
          saveConfigBaseUrl(url);
        } catch (e: any) {
          console.error(e?.message ?? e);
          process.exit(1);
        }
        console.log(`Wrote baseUrl to ${CONFIG_FILE}`);
        break;
      }
      const { baseUrl: shown, source } = loadConfigWithSource();
      console.log(shown ? `base_url: ${shown}` : 'base_url: (not set)');
      console.log(`source: ${source}`);
      break;
    }
    case 'login':
      await login(apiBase);
      break;
    case 'list':
      await listProblems(apiBase, requireToken(token), {});
      break;
    case 'show':
      if (!args[1]) { console.error('Usage: hydrooj-cli show <problem_id>'); process.exit(1); }
      await showProblem(apiBase, requireToken(token), args[1]);
      break;
    case 'status':
      await showStatus(apiBase, requireToken(token), args[1]);
      break;
    case 'homework':
      await listHomework(apiBase, requireToken(token));
      break;
    case 'contests':
      await listContests(apiBase, requireToken(token));
      break;
    case 'homework-detail':
      if (!args[1]) { console.error('Usage: hydrooj-cli homework-detail <homework_id>'); process.exit(1); }
      await homeworkDetail(apiBase, requireToken(token), args[1]);
      break;
    case 'homework-problems':
      if (!args[1]) { console.error('Usage: hydrooj-cli homework-problems <homework_id>'); process.exit(1); }
      await homeworkProblems(apiBase, requireToken(token), args[1]);
      break;
    case 'contest-detail':
      if (!args[1]) { console.error('Usage: hydrooj-cli contest-detail <contest_id>'); process.exit(1); }
      await contestDetail(apiBase, requireToken(token), args[1]);
      break;
    case 'contest-problems':
      if (!args[1]) { console.error('Usage: hydrooj-cli contest-problems <contest_id>'); process.exit(1); }
      await contestProblems(apiBase, requireToken(token), args[1]);
      break;
    case 'problem-upload': {
      const zipPath = args[1];
      if (!zipPath) {
        console.error('Usage: hydrooj-cli problem-upload <path-to-problem.zip>');
        process.exit(1);
      }
      const abs = path.resolve(zipPath);
      if (!fs.existsSync(abs)) {
        console.error(`File not found: ${abs}`);
        process.exit(1);
      }
      const out = await apiMultipartRequest(apiBase, '/rest-api/problems', requireToken(token), abs);
      console.log(JSON.stringify(out, null, 2));
      break;
    }
    case 'contest-create': {
      const payload = await readJsonWritePayloadAsync(args.slice(1));
      const out = await apiRequest(apiBase, '/rest-api/contests', 'POST', payload, requireToken(token));
      console.log(JSON.stringify(out, null, 2));
      break;
    }
    case 'homework-create': {
      const payload = await readJsonWritePayloadAsync(args.slice(1));
      const out = await apiRequest(apiBase, '/rest-api/homework', 'POST', payload, requireToken(token));
      console.log(JSON.stringify(out, null, 2));
      break;
    }
    case 'training-create': {
      const payload = await readJsonWritePayloadAsync(args.slice(1));
      const out = await apiRequest(apiBase, '/rest-api/trainings', 'POST', payload, requireToken(token));
      console.log(JSON.stringify(out, null, 2));
      break;
    }
    default:
      console.error(`Unknown command: ${cmd}`);
      console.error('Run with help, -h, or --help for usage.');
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('Error:', err?.message ?? err);
  printAddonHintIfNeeded(err);
  process.exit(1);
});
