#!/usr/bin/env node
/**
 * HydroOJ CLI - TypeScript/Node.js client for HydroOJ REST API addon
 */
import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';

interface Config {
  baseUrl: string;
}

interface Session {
  token: string;
}

const CONFIG_DIR = path.join(process.env.HOME || '', '.config', 'hydrooj_cli');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const SESSION_FILE = path.join(CONFIG_DIR, 'session.json');

function loadConfig(): string {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
      return data.baseUrl || 'http://localhost:3000';
    }
  } catch {}
  return process.env.HYDRO_API_URL || 'http://localhost:3000';
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

function apiRequest(baseUrl: string, apiPath: string, method: string = 'GET', body?: object, token?: string | null): Promise<any> {
  return new Promise((resolve, reject) => {
    const url = new URL(apiPath, baseUrl);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;

    const options: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 3000),
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      timeout: 30000,
    };

    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(new Error(json.message || `HTTP ${res.statusCode}`));
          } else {
            resolve(json);
          }
        } catch {
          reject(new Error(`Invalid response: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => req.destroy());

    if (body) {
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
    const data = await apiRequest(baseUrl, '/api/login', 'GET', { username, password });
    if (data.token) {
      saveSession(data.token);
      console.log(`Logged in as ${data.uname} (uid=${data.uid})`);
    }
  } catch (err: any) {
    console.error('Login failed:', err.message);
    process.exit(1);
  }
}

async function listProblems(baseUrl: string, token: string, args: any): Promise<void> {
  const params = new URLSearchParams({ page: '1', pageSize: '20', ...args });
  const data = await apiRequest(baseUrl, `/api/problems?${params}`, 'GET', undefined, token);

  console.log(`\nProblems (Total: ${data.total})`);
  console.log(`Page ${data.page}/${data.totalPages}\n`);

  for (const p of data.items) {
    const tags = (p.tag || []).join(', ');
    console.log(`  [${p.pid}] ${p.title} (Difficulty: ${p.difficulty}, Tags: ${tags})`);
  }
}

async function showProblem(baseUrl: string, token: string, id: string): Promise<void> {
  const data = await apiRequest(baseUrl, `/api/problems/${id}`, 'GET', undefined, token);

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

async function submit(baseUrl: string, token: string, args: any): Promise<void> {
  let code: string;
  if (args.file) {
    code = fs.readFileSync(args.file, 'utf-8');
  } else {
    console.log('Enter code (Ctrl+D to finish):');
    code = fs.readFileSync('/dev/stdin', 'utf-8');
  }

  const data = await apiRequest(baseUrl, '/api/submit', 'POST', {
    problemId: args.problem_id,
    code,
    language: args.language || 'cpp',
  }, token);

  console.log(`Submitted! Submission ID: ${data.id}`);
  console.log("Use `hydrooj status <id>` to check the result.");
}

async function showStatus(baseUrl: string, token: string, id?: string): Promise<void> {
  if (!id) {
    const data = await apiRequest(baseUrl, '/api/submissions?page=1&pageSize=20', 'GET', undefined, token);
    console.log('\nRecent Submissions');
    for (const s of data.items) {
      console.log(`  [${s.id}] #${s.pid} - ${s.status} (${s.score}%)`);
    }
  } else {
    const data = await apiRequest(baseUrl, `/api/submissions/${id}`, 'GET', undefined, token);
    console.log(`\nSubmission #${data.id}`);
    console.log(`Problem: #${data.pid}`);
    console.log(`Status: ${data.status}`);
    console.log(`Score: ${data.score}%`);
    console.log(`Time: ${data.time}ms`);
    console.log(`Memory: ${data.memory}KB`);
    console.log(`Language: ${data.language}`);
  }
}

async function listContests(baseUrl: string, token: string): Promise<void> {
  const data = await apiRequest(baseUrl, '/api/contests?page=1&pageSize=20', 'GET', undefined, token);

  console.log(`\nContests (Total: ${data.total})`);
  for (const c of data.items) {
    console.log(`  [${c.id}] ${c.title} (${c.status})`);
  }
}

// Helper: find contest/homework item by ID from the list (workaround for broken detail endpoints)
async function findContestListItem(baseUrl: string, token: string, id: string, listPath: string, typeName: string): Promise<any> {
  const data = await apiRequest(baseUrl, `/${listPath}?page=1&pageSize=1000`, 'GET', undefined, token);
  const item = (data.items || []).find((c: any) => c.id === id || c.id === String(id));
  if (!item) {
    console.error(`${typeName} ${id} not found. You can list all with: hydrooj-cli contests`);
    process.exit(1);
  }
  return item;
}

function formatContestItem(label: string, item: any): void {
  console.log(`\n${label} [${item.id}]: ${item.title}`);
  console.log(`Start: ${item.startAt || '(N/A)'}  End: ${item.endAt}`);
  console.log(`Rule: ${item.rule}  Status: ${item.status}`);
  if (item.description && item.description.trim()) {
    console.log(`\n${item.description}`);
  }
}

async function contestDetail(baseUrl: string, token: string, id: string): Promise<void> {
  // Workaround: GET /api/contests/:id is broken on server (always returns "Contest not found")
  // Fetch from list and filter client-side
  const item = await findContestListItem(baseUrl, token, id, 'api/contests', 'Contest');
  formatContestItem('Contest', item);
}

function formatHomeworkItem(item: any): void {
  console.log(`\nHomework [${item.id}]: ${item.title}`);
  console.log(`Start: ${item.startAt || '(N/A)'}  End: ${item.endAt}`);
  console.log(`Rule: ${item.rule}  Status: ${item.status}`);
  if (item.description && item.description.trim()) {
    console.log(`\n${item.description}`);
  }
}

async function homeworkDetail(baseUrl: string, token: string, id: string): Promise<void> {
  // Workaround: GET /api/homework/:id always returns 404
  const item = await findContestListItem(baseUrl, token, id, 'api/homework', 'Homework');
  formatHomeworkItem(item);
}

async function main() {
  const baseUrl = loadConfig();
  const token = loadSession();

  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd) {
    console.log('Usage: hydrooj <command> [args]');
    console.log('\nCommands:');
    console.log('  login               Login to HydroOJ');
    console.log('  list [--tag X]      List problems');
    console.log('  show <id>           Show problem details');
    console.log('  submit <id> -f <file>  Submit code');
    console.log('  status [id]         Check submission status');
    console.log('  contests            List contests');
    process.exit(1);
  }

  switch (cmd) {
    case 'login':
      await login(baseUrl);
      break;
    case 'list':
      if (!token) { console.error('Not logged in. Run "hydrooj login" first.'); process.exit(1); }
      await listProblems(baseUrl, token, {});
      break;
    case 'show':
      if (!token) { console.error('Not logged in. Run "hydrooj login" first.'); process.exit(1); }
      if (!args[1]) { console.error('Usage: hydrooj show <problem_id>'); process.exit(1); }
      await showProblem(baseUrl, token, args[1]);
      break;
    case 'submit':
      if (!token) { console.error('Not logged in. Run "hydrooj login" first.'); process.exit(1); }
      if (!args[1]) { console.error('Usage: hydrooj submit <problem_id> [-f file] [-l language]'); process.exit(1); }
      await submit(baseUrl, token, { problem_id: args[1], file: args[2], language: args[3] });
      break;
    case 'status':
      if (!token) { console.error('Not logged in. Run "hydrooj login" first.'); process.exit(1); }
      await showStatus(baseUrl, token, args[1]);
      break;
    case 'contests':
      if (!token) { console.error('Not logged in. Run "hydrooj login" first.'); process.exit(1); }
      await listContests(baseUrl, token);
      break;
    case 'contest-detail': {
      if (!token) { console.error('Not logged in. Run "hydrooj login" first.'); process.exit(1); }
      if (!args[1]) { console.error('Usage: hydrooj contest-detail <contest_id>'); process.exit(1); }
      await contestDetail(baseUrl, token, args[1]);
      break;
    }
    case 'homework-detail': {
      if (!token) { console.error('Not logged in. Run "hydrooj login" first.'); process.exit(1); }
      if (!args[1]) { console.error('Usage: hydrooj homework-detail <homework_id>'); process.exit(1); }
      await homeworkDetail(baseUrl, token, args[1]);
      break;
    }
    default:
      console.error(`Unknown command: ${cmd}`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
