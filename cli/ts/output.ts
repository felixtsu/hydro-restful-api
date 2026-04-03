/**
 * HydroOJ CLI Output Helpers
 */
import { ListResponse, ProblemOutput, ContestOutput, HomeworkOutput, SubmissionOutput } from './contracts';
import { CliError, normalizeError } from './errors';

export let outputMode: 'json' | 'human' = 'human';
export let prettyJson: boolean = false;
export let quiet: boolean = false;

export function setOutputMode(mode: 'json' | 'human') { outputMode = mode; }
export function setPrettyJson(p: boolean) { prettyJson = p; }
export function setQuiet(q: boolean) { quiet = q; }

export function renderJson(value: any) {
  const s = prettyJson ? JSON.stringify(value, null, 2) : JSON.stringify(value);
  process.stdout.write(s + '\n');
}

export function renderError(err: any) {
  const error = normalizeError(err);
  if (outputMode === 'json') {
    renderJson({ error });
  } else {
    process.stderr.write(`Error: ${error.message} (code: ${error.code}${error.httpStatus ? `, HTTP ${error.httpStatus}` : ''})\n`);
    if (error.hint) {
      process.stderr.write(`Hint: ${error.hint}\n`);
    }
  }
}

export function printDiagnostic(text: string) {
  if (outputMode === 'human' && !quiet) {
    process.stdout.write(text + '\n');
  }
}

export function printHuman(text: string) {
  if (outputMode === 'human') {
    process.stdout.write(text + '\n');
  }
}

// Normalizers from raw API response to contract types

export function normalizeProblem(p: any): ProblemOutput {
  return {
    id: p.docId ?? p.id,
    displayId: p.pid || null,
    title: p.title,
    difficulty: p.difficulty,
    tag: p.tag,
    accepted: p.accepted,
    submission: p.submission,
    timeLimit: p.timeLimit,
    memoryLimit: p.memoryLimit,
    content: p.content,
    samples: p.samples,
  };
}

export function normalizeProblemList(data: any): ListResponse<ProblemOutput> {
  return {
    items: (data.items || []).map(normalizeProblem),
    page: data.page,
    pageSize: data.pageSize,
    total: data.total,
    totalPages: data.totalPages,
  };
}

export function normalizeContest(c: any): ContestOutput {
  return {
    id: c._id || c.id,
    displayId: c.displayId || null,
    title: c.title,
    rule: c.rule,
    status: c.status,
    description: c.description,
    startAt: c.startAt,
    endAt: c.endAt,
    problemIds: c.problems,
  };
}

export function normalizeContestList(data: any): ListResponse<ContestOutput> {
  return {
    items: (data.items || []).map(normalizeContest),
    page: data.page,
    pageSize: data.pageSize,
    total: data.total,
    totalPages: data.totalPages,
  };
}

export function normalizeHomework(c: any): HomeworkOutput {
  return normalizeContest(c) as HomeworkOutput;
}

export function normalizeHomeworkList(data: any): ListResponse<HomeworkOutput> {
  return normalizeContestList(data) as ListResponse<HomeworkOutput>;
}

export function normalizeSubmission(s: any): SubmissionOutput {
  return {
    id: s._id || s.id,
    problemId: s.docId || s.problemId,
    displayProblemId: s.pid,
    status: s.status,
    score: s.score,
    time: s.time,
    memory: s.memory,
    language: s.language,
    submitAt: s.submitAt,
  };
}

export function normalizeSubmissionList(data: any): ListResponse<SubmissionOutput> {
  return {
    items: (data.items || []).map(normalizeSubmission),
    page: data.page,
    pageSize: data.pageSize,
    total: data.total,
    totalPages: data.totalPages,
  };
}

// Human formatters

export function humanProblem(p: ProblemOutput) {
  let out = `[id=${p.id}${p.displayId ? ` display=${p.displayId}` : ''}] ${p.title}`;
  if (p.difficulty !== undefined) out += ` (Difficulty: ${p.difficulty})`;
  if (p.tag && p.tag.length) out += ` (Tags: ${p.tag.join(', ')})`;
  return out;
}

export function humanProblemDetail(p: ProblemOutput) {
  let out = `\n#${p.displayId || p.id}: ${p.title}\n`;
  out += `id: ${p.id}\n`;
  if (p.difficulty !== undefined) out += `Difficulty: ${p.difficulty}\n`;
  if (p.tag && p.tag.length) out += `Tags: ${p.tag.join(', ')}\n`;
  if (p.timeLimit !== undefined) out += `Time Limit: ${p.timeLimit}ms\n`;
  if (p.memoryLimit !== undefined) out += `Memory Limit: ${p.memoryLimit}MB\n`;
  if (p.accepted !== undefined) out += `AC/Submit: ${p.accepted}/${p.submission || 0}\n`;
  out += `\n${p.content || 'No description'}\n`;
  if (p.samples && p.samples.length) {
    out += '\nSamples:';
    p.samples.forEach((s, i) => {
      out += `\n\nSample ${i + 1}:`;
      out += `\n  Input: ${s.input}`;
      out += `\n  Output: ${s.output}`;
    });
  }
  return out;
}

export function humanContestSummary(c: ContestOutput | HomeworkOutput, label: string = 'Contest') {
  return `  [id=${c.id}] ${c.title} (${c.status})`;
}

export function humanContestDetail(c: ContestOutput | HomeworkOutput, label: string = 'Contest') {
  let out = `\n${label} [${c.id}]: ${c.title}\n`;
  out += `Rule: ${c.rule}  Status: ${c.status}\n`;
  out += `Start: ${c.startAt}  End: ${c.endAt}\n`;
  if (c.description) out += `\n${c.description}\n`;
  if (c.problemIds && c.problemIds.length) {
    out += `\nProblem ids: ${c.problemIds.join(', ')}\n`;
  }
  return out;
}

export function humanSubmissionSummary(s: SubmissionOutput) {
  return `  [id=${s.id}] problemId=${s.problemId}${s.displayProblemId ? ` (display=${s.displayProblemId})` : ''} - ${s.status} (${s.score}%)`;
}

export function humanSubmissionDetail(s: SubmissionOutput) {
  let out = `\nSubmission #${s.id}\n`;
  out += `Problem: ${s.problemId}${s.displayProblemId ? ` (${s.displayProblemId})` : ''}\n`;
  out += `Status: ${s.status}\n`;
  out += `Score: ${s.score}%\n`;
  out += `Time: ${s.time}ms\n`;
  out += `Memory: ${s.memory}KB\n`;
  out += `Language: ${s.language}\n`;
  return out;
}
