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
import { 
  setOutputMode, setPrettyJson, setQuiet, 
  renderJson, renderError, printHuman,
  normalizeProblemList, normalizeProblem,
  normalizeSubmissionList, normalizeSubmission,
  normalizeHomeworkList, normalizeHomework,
  normalizeContestList, normalizeContest,
  humanProblem, humanProblemDetail,
  humanSubmissionSummary, humanSubmissionDetail,
  humanContestSummary, humanContestDetail,
  outputMode
} from './output';

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
    throw new Error('No base URL configured. Set your OJ site root, for example: hydrooj-cli config base-url https://your-oj.example.com');
  }
  return u;
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
    throw new Error('Not logged in. Run "hydrooj-cli login" first.');
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

      // Backspace/Delete (no screen echo — password entry stays hidden)
      if (s === '\u007f' || s === '\b') {
        if (password.length > 0) password = password.slice(0, -1);
        return;
      }

      // Ignore escape sequences (arrow keys, etc.)
      if (s.startsWith('\u001b')) return;

      // Most passwords are ASCII; for other chars, treat each keypress as 1 char.
      password += s;
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
  // Close readline before hidden password input so it does not also handle stdin
  // (otherwise the terminal echoes the real character and we would print '*' too).
  rl.close();
  const password = await questionHidden('Password: ');

  try {
    const data = await apiRequest(baseUrl, '/rest-api/login', 'POST', { username, password });
    if (data.token) {
      saveSession(data.token);
      printHuman(`Logged in as ${data.uname} (uid=${data.uid})`);
    } else {
      throw new Error('Login failed: response had no token: ' + JSON.stringify(data));
    }
  } catch (err: any) {
    throw err;
  }
}

async function listProblems(baseUrl: string, token: string, args: any): Promise<void> {
  const data = await apiRequest(baseUrl, '/rest-api/problems', 'GET', { page: '1', pageSize: '20', ...args }, token);

  const normalized = normalizeProblemList(data);
  if (outputMode === 'json') {
    renderJson(normalized);
  } else {
    printHuman(`\nProblems (Total: ${normalized.total})`);
    printHuman(`Page ${normalized.page}/${normalized.totalPages}\n`);
    for (const p of normalized.items) {
      printHuman(humanProblem(p));
    }
  }
}

async function showProblem(baseUrl: string, token: string, id: string): Promise<void> {
  const data = await apiRequest(baseUrl, `/rest-api/problems/${id}`, 'GET', undefined, token);
  const normalized = normalizeProblem(data);
  if (outputMode === 'json') {
    renderJson(normalized);
  } else {
    printHuman(humanProblemDetail(normalized));
  }
}

async function showStatus(baseUrl: string, token: string, id?: string): Promise<void> {
  if (!id) {
    const data = await apiRequest(baseUrl, '/rest-api/submissions', 'GET', { page: '1', pageSize: '20' }, token);
    const normalized = normalizeSubmissionList(data);
    if (outputMode === 'json') {
      renderJson(normalized);
    } else {
      printHuman('\nRecent Submissions');
      for (const s of normalized.items) {
        printHuman(humanSubmissionSummary(s));
      }
    }
  } else {
    const data = await apiRequest(baseUrl, `/rest-api/submissions/${id}`, 'GET', undefined, token);
    const normalized = normalizeSubmission(data);
    if (outputMode === 'json') {
      renderJson(normalized);
    } else {
      printHuman(humanSubmissionDetail(normalized));
    }
  }
}

async function listHomework(baseUrl: string, token: string): Promise<void> {
  const data = await apiRequest(baseUrl, '/rest-api/homework', 'GET', { page: '1', pageSize: '20' }, token);
  const normalized = normalizeHomeworkList(data);
  if (outputMode === 'json') {
    renderJson(normalized);
  } else {
    printHuman(`\nHomework (Total: ${normalized.total})`);
    for (const c of normalized.items) {
      printHuman(humanContestSummary(c, 'Homework'));
    }
  }
}

async function listContests(baseUrl: string, token: string): Promise<void> {
  const data = await apiRequest(baseUrl, '/rest-api/contests', 'GET', { page: '1', pageSize: '20' }, token);
  const normalized = normalizeContestList(data);
  if (outputMode === 'json') {
    renderJson(normalized);
  } else {
    printHuman(`\nContests (Total: ${normalized.total})`);
    for (const c of normalized.items) {
      printHuman(humanContestSummary(c, 'Contest'));
    }
  }
}

async function homeworkDetail(baseUrl: string, token: string, id: string): Promise<void> {
  const data = await apiRequest(baseUrl, `/rest-api/homework/${id}`, 'GET', undefined, token);
  const normalized = normalizeHomework(data);
  if (outputMode === 'json') {
    renderJson(normalized);
  } else {
    printHuman(humanContestDetail(normalized, 'Homework'));
  }
}

async function homeworkProblems(baseUrl: string, token: string, id: string): Promise<void> {
  const data = await apiRequest(baseUrl, `/rest-api/homework/${id}/problems`, 'GET', undefined, token);
  const normalized = normalizeProblemList(data);
  if (outputMode === 'json') {
    renderJson(normalized);
  } else {
    printHuman(`\nHomework problems (${normalized.items.length})`);
    for (const p of normalized.items) {
      printHuman(`  [#${p.displayId || p.id}] ${p.title}`);
    }
  }
}

async function contestDetail(baseUrl: string, token: string, id: string): Promise<void> {
  const data = await apiRequest(baseUrl, `/rest-api/contests/${id}`, 'GET', undefined, token);
  const normalized = normalizeContest(data);
  if (outputMode === 'json') {
    renderJson(normalized);
  } else {
    printHuman(humanContestDetail(normalized, 'Contest'));
  }
}

async function contestProblems(baseUrl: string, token: string, id: string): Promise<void> {
  const data = await apiRequest(baseUrl, `/rest-api/contests/${id}/problems`, 'GET', undefined, token);
  const normalized = normalizeProblemList(data);
  if (outputMode === 'json') {
    renderJson(normalized);
  } else {
    printHuman(`\nContest problems (${normalized.items.length})`);
    for (const p of normalized.items) {
      printHuman(`  [#${p.displayId || p.id}] ${p.title}`);
    }
  }
}

function printHelp(): void {
  console.log(`HydroOJ REST CLI (TypeScript) 2.x

First-time setup (your Hydro server needs the hydrooj-rest-api addon):
  hydrooj-cli config base-url https://your-oj.example.com

Usage:
  hydrooj-cli [global-flags] <command> [args]
  (after: npm install -g hydrooj-cli)

Global Flags:
  --json                Output machine-readable JSON
  --pretty              Pretty-print JSON output
  --quiet               Suppress non-essential diagnostics in human mode

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
`);
}

async function main() {
  const rawArgs = process.argv.slice(2);

  // Parse global flags (can appear anywhere, consumed before command dispatch)
  const GLOBAL_FLAGS = new Set(['--json', '--pretty', '--quiet']);
  const args: string[] = [];
  for (let i = 0; i < rawArgs.length; i++) {
    if (GLOBAL_FLAGS.has(rawArgs[i])) {
      if (rawArgs[i] === '--json') setOutputMode('json');
      else if (rawArgs[i] === '--pretty') setPrettyJson(true);
      else if (rawArgs[i] === '--quiet') setQuiet(true);
    } else {
      args.push(rawArgs[i]);
    }
  }

  const baseUrl = loadConfig();
  const token = loadSession();

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
          throw new Error('Usage: hydrooj-cli config base-url <url>');
        }
        saveConfigBaseUrl(url);
        printHuman(`Wrote baseUrl to ${CONFIG_FILE}`);
        break;
      }
      const { baseUrl: shown, source } = loadConfigWithSource();
      if (outputMode === 'json') {
        renderJson({ baseUrl: shown, source });
      } else {
        printHuman(shown ? `base_url: ${shown}` : 'base_url: (not set)');
        printHuman(`source: ${source}`);
      }
      break;
    }
    case 'login':
      await login(apiBase);
      break;
    case 'list':
      await listProblems(apiBase, requireToken(token), {});
      break;
    case 'show':
      if (!args[1]) { throw new Error('Usage: hydrooj-cli show <problem_id>'); }
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
      if (!args[1]) { throw new Error('Usage: hydrooj-cli homework-detail <homework_id>'); }
      await homeworkDetail(apiBase, requireToken(token), args[1]);
      break;
    case 'homework-problems':
      if (!args[1]) { throw new Error('Usage: hydrooj-cli homework-problems <homework_id>'); }
      await homeworkProblems(apiBase, requireToken(token), args[1]);
      break;
    case 'contest-detail':
      if (!args[1]) { throw new Error('Usage: hydrooj-cli contest-detail <contest_id>'); }
      await contestDetail(apiBase, requireToken(token), args[1]);
      break;
    case 'contest-problems':
      if (!args[1]) { throw new Error('Usage: hydrooj-cli contest-problems <contest_id>'); }
      await contestProblems(apiBase, requireToken(token), args[1]);
      break;
    case 'problem-upload': {
      const zipPath = args[1];
      if (!zipPath) {
        throw new Error('Usage: hydrooj-cli problem-upload <path-to-problem.zip>');
      }
      const abs = path.resolve(zipPath);
      if (!fs.existsSync(abs)) {
        throw new Error(`File not found: ${abs}`);
      }
      const out = await apiMultipartRequest(apiBase, '/rest-api/problems', requireToken(token), abs);
      renderJson(out);
      break;
    }
    case 'contest-create': {
      const payload = await readJsonWritePayloadAsync(args.slice(1));
      const out = await apiRequest(apiBase, '/rest-api/contests', 'POST', payload, requireToken(token));
      renderJson(out);
      break;
    }
    case 'homework-create': {
      const payload = await readJsonWritePayloadAsync(args.slice(1));
      const out = await apiRequest(apiBase, '/rest-api/homework', 'POST', payload, requireToken(token));
      renderJson(out);
      break;
    }
    case 'training-create': {
      const payload = await readJsonWritePayloadAsync(args.slice(1));
      const out = await apiRequest(apiBase, '/rest-api/trainings', 'POST', payload, requireToken(token));
      renderJson(out);
      break;
    }
    default:
      throw new Error(`Unknown command: ${cmd}`);
  }
}

main().catch((err) => {
  renderError(err);
  process.exit(1);
});
