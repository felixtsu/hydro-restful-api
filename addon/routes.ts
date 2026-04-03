import { createHmac, timingSafeEqual } from 'crypto';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { Context, Handler, LoginError, param, Types } from 'hydrooj';

function signToken(payload: Record<string, any>, secret: string, expiresInSec: number): string {
    const exp = Math.floor(Date.now() / 1000) + expiresInSec;
    const data = Buffer.from(JSON.stringify({ ...payload, exp })).toString('base64url');
    const sig = createHmac('sha256', secret).update(data).digest('base64url');
    return `${data}.${sig}`;
}

function verifyTokenStr(token: string, secret: string): Record<string, any> | null {
    const idx = token.lastIndexOf('.');
    if (idx < 0) return null;
    const data = token.slice(0, idx);
    const sig = token.slice(idx + 1);
    const expectedSig = createHmac('sha256', secret).update(data).digest('base64url');
    if (sig.length !== expectedSig.length) return null;
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) return null;
    try {
        const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
        if (payload.exp && payload.exp < Date.now() / 1000) return null;
        return payload;
    } catch {
        return null;
    }
}

function verifyToken(auth: string | undefined, secret: string) {
    if (!auth?.startsWith('Bearer ')) return null;
    return verifyTokenStr(auth.slice(7), secret) as { uid: number; uname: string; domainId: string } | null;
}

function M() {
    return (global as any).Hydro.model as Record<string, any>;
}

async function readJsonBodyIfNeeded(req: any): Promise<any | null> {
    return await new Promise((resolve) => {
        let data = '';
        try {
            req.on('data', (chunk: any) => { data += chunk?.toString?.('utf8') ?? String(chunk); });
            req.on('end', () => {
                if (!data.trim()) return resolve(null);
                try {
                    resolve(JSON.parse(data));
                } catch {
                    resolve(null);
                }
            });
            req.on('error', () => resolve(null));
        } catch {
            resolve(null);
        }
    });
}

// Helper to load full UserDoc with hasPerm method
async function loadUser(domainId: string, uid: number) {
    return await M().user.getById(domainId, uid);
}

function effectiveDomainId(handler: Handler, tokenDomainId: string): string {
    const fromCtx = (handler as any).domain?._id as string | undefined;
    return fromCtx || tokenDomainId;
}

// Auth middleware: validates Bearer JWT, loads udoc. Returns null and sends 401 if invalid.
// Uses the request domain (e.g. /d/<domain>/...) when present, not only the token payload.
async function requireAuth(this: Handler, jwtSecret: string): Promise<{ uid: number; uname: string; domainId: string; udoc: any } | null> {
    const auth = this.request.headers.authorization;
    const token = verifyToken(auth, jwtSecret);
    if (!token) {
        this.response.status = 401;
        this.response.body = { error: 'UNAUTHORIZED', message: 'Invalid or missing token' };
        return null;
    }
    const domainId = effectiveDomainId(this, token.domainId);
    const udoc = await loadUser(domainId, token.uid);
    if (!udoc) {
        this.response.status = 401;
        this.response.body = { error: 'UNAUTHORIZED', message: 'Invalid or missing token' };
        return null;
    }
    return { uid: token.uid, uname: token.uname, domainId, udoc };
}

// Permission check: returns false and sends 403 if lacking permission
function requirePerm(this: Handler, udoc: any, permName: string): boolean {
    const PERM = M().builtin.PERM;
    const perm = (PERM as any)[permName];
    if (!udoc.hasPerm(perm)) {
        this.response.status = 403;
        this.response.body = { error: 'FORBIDDEN', message: `Missing permission: ${permName}` };
        return false;
    }
    return true;
}

function badRequest(this: Handler, message: string) {
    this.response.status = 400;
    this.response.body = { error: 'BAD_REQUEST', message };
}

function parseBoolLoose(v: any, defaultVal: boolean): boolean {
    if (v === undefined || v === null || v === '') return defaultVal;
    if (typeof v === 'boolean') return v;
    const s = String(v).toLowerCase();
    if (s === 'true' || s === '1' || s === 'yes') return true;
    if (s === 'false' || s === '0' || s === 'no') return false;
    return defaultVal;
}

function normalizeScoreRecord(score: any): Record<number, number> | undefined {
    if (score == null || typeof score !== 'object' || Array.isArray(score)) return undefined;
    const out: Record<number, number> = {};
    for (const [k, v] of Object.entries(score)) {
        const nk = Number(k);
        if (!Number.isFinite(nk) || typeof v !== 'number' || !Number.isFinite(v)) continue;
        out[nk] = v;
    }
    return Object.keys(out).length ? out : undefined;
}

function trainingDagHasCycle(nodes: { _id: number; requireNids: number[] }[]): boolean {
    const ids = new Set(nodes.map((n) => n._id));
    const adj = new Map<number, number[]>();
    for (const n of nodes) {
        for (const r of n.requireNids) {
            if (!ids.has(r)) continue;
            if (!adj.has(r)) adj.set(r, []);
            adj.get(r)!.push(n._id);
        }
    }
    const visiting = new Set<number>();
    const visited = new Set<number>();
    function visit(u: number): boolean {
        if (visiting.has(u)) return true;
        if (visited.has(u)) return false;
        visiting.add(u);
        for (const v of adj.get(u) || []) {
            if (visit(v)) return true;
        }
        visiting.delete(u);
        visited.add(u);
        return false;
    }
    for (const id of ids) {
        if (visit(id)) return true;
    }
    return false;
}

const contestOnlyQuery = { rule: { $ne: 'homework' } };
const homeworkQuery = { rule: 'homework' };

// Helper: contest.get() expects numeric docId, but list returns _id.toString() (ObjectId).
// Try ObjectId lookup first, then fall back to docId.
async function findContest(domainId: string, id: string) {
    // Try ObjectId lookup
    try {
        const models = M();
        const ObjectId = models.db.ObjectID || models.db.ObjectId;
        const oid = new ObjectId(id);
        const cdoc = await models.contest.getMulti(domainId, { _id: oid }).toArray();
        if (cdoc?.length) return cdoc[0];
    } catch { /* not an ObjectId, fall through */ }
    // Fall back: try numeric docId
    if (/^\d+$/.test(id)) {
        return await M().contest.get(domainId, id);
    }
    return null;
}

export function registerRestApiRoutes(ctx: Context, jwtSecret: string) {
    // Login
    ctx.Route('rest_login', '/rest-api/login', class extends Handler {
        async get() {
            this.response.body = {
                error: 'BAD_REQUEST',
                message: 'Use POST /rest-api/login with JSON body {username, password}',
            };
            this.response.status = 400;
        }

        async post() {
            let src = (this.request.body || this.request.query) as any;
            if (!src || typeof src !== 'object') {
                src = await readJsonBodyIfNeeded(this.request);
            }
            const { username, password } = src || {};

            if (!username || !password) {
                this.response.body = { error: 'BAD_REQUEST', message: 'username and password required' };
                this.response.status = 400;
                return;
            }

            const udoc = await M().user.getByEmail('system', username)
                || await M().user.getByUname('system', username);
            if (!udoc) {
                this.response.body = { error: 'INVALID_CREDENTIALS', message: 'Invalid username or password' };
                this.response.status = 401;
                return;
            }

            try {
                await udoc.checkPassword(password);
            } catch (e) {
                if (!(e instanceof LoginError)) throw e;
                this.response.body = { error: 'INVALID_CREDENTIALS', message: 'Invalid username or password' };
                this.response.status = 401;
                return;
            }

            const token = signToken(
                { uid: udoc._id, uname: udoc.uname, domainId: 'system' },
                jwtSecret,
                7 * 24 * 3600,
            );
            this.response.body = { token, uid: udoc._id, uname: udoc.uname };
        }
    });

    class RestProblemsListHandler extends Handler {
        async get() {
            const auth = await requireAuth.call(this, jwtSecret);
            if (!auth) return;
            if (!requirePerm.call(this, auth.udoc, 'PERM_VIEW_PROBLEM')) return;

            const { page = '1', pageSize = '20', tag, difficulty, keyword } = this.request.query as any;
            const query: any = {};
            if (tag) query.tag = tag;
            if (difficulty) query.difficulty = parseInt(difficulty);
            if (keyword) {
                query.$or = [
                    { title: { $regex: keyword, $options: 'i' } },
                    { pid: { $regex: keyword, $options: 'i' } },
                ];
            }
            const skip = (parseInt(page) - 1) * parseInt(pageSize);
            const limit = Math.min(parseInt(pageSize), 100);
            const pdocs = await M().problem.getMulti(auth.domainId, query)
                .skip(skip).limit(limit).toArray();
            const total = await M().problem.count(auth.domainId, query);
            this.response.body = {
                items: pdocs.map(p => ({
                    id: p.docId || p.pid,
                    pid: p.pid,
                    title: p.title,
                    difficulty: p.difficulty,
                    tag: p.tag || [],
                    accepted: p.accepted || 0,
                    submission: p.submission || 0,
                })),
                page: parseInt(page),
                pageSize: limit,
                total,
                totalPages: Math.ceil(total / limit),
            };
        }
    }

    class RestProblemUploadHandler extends RestProblemsListHandler {
        async post() {
            const auth = await requireAuth.call(this, jwtSecret);
            if (!auth) return;
            if (!requirePerm.call(this, auth.udoc, 'PERM_CREATE_PROBLEM')) return;

            const zipField = (this.request.files as any)?.zip ?? (this.request.files as any)?.file;
            if (!zipField?.filepath && !zipField?.path) {
                badRequest.call(this, 'zip file is required (multipart field "zip")');
                return;
            }
            const srcPath = zipField.filepath || zipField.path;

            const body = (this.request.body || {}) as any;
            const titleOpt = body.title != null && body.title !== '' ? String(body.title) : undefined;
            const contentOpt = body.content != null && body.content !== '' ? String(body.content) : undefined;
            const tagsOpt = body.tags != null && body.tags !== '' ? String(body.tags) : undefined;
            const difficultyOpt = body.difficulty !== undefined && body.difficulty !== ''
                ? Number(body.difficulty)
                : undefined;
            const hidden = parseBoolLoose(body.hidden, false);
            const pidOpt = body.pid != null && String(body.pid).trim() !== '' ? String(body.pid).trim() : undefined;

            const tmpdir = path.join(os.tmpdir(), 'hydro-upload', Math.random().toString(36).slice(2));
            const zipPath = path.join(tmpdir, 'problem.zip');
            try {
                await fs.ensureDir(tmpdir);
                await fs.copy(srcPath, zipPath);

                const before = await M().problem.getMulti(auth.domainId, {})
                    .sort({ docId: -1 }).limit(1).project({ docId: 1 }).toArray();
                const maxBefore = before[0]?.docId ?? 0;

                await M().problem.import(auth.domainId, zipPath, {
                    preferredPrefix: pidOpt || undefined,
                    operator: auth.uid,
                    delSource: false,
                    hidden,
                });

                const imported = await M().problem.getMulti(auth.domainId, { docId: { $gt: maxBefore } })
                    .sort({ docId: -1 }).project({ docId: 1, pid: 1, title: 1 }).toArray();
                const pdoc = imported[0];
                if (!pdoc) {
                    badRequest.call(this, 'Import finished but no new problem was created');
                    return;
                }

                const tagArr = tagsOpt
                    ? tagsOpt.split(',').map((t: string) => t.trim()).filter(Boolean)
                    : undefined;
                const edit: any = {};
                if (titleOpt !== undefined) edit.title = titleOpt;
                if (contentOpt !== undefined) edit.content = contentOpt;
                if (tagArr !== undefined) edit.tag = tagArr;
                if (difficultyOpt !== undefined && Number.isFinite(difficultyOpt)) {
                    const d = Math.max(0, Math.min(5, Math.floor(difficultyOpt)));
                    edit.difficulty = d;
                }
                if (Object.keys(edit).length) {
                    await M().problem.edit(auth.domainId, pdoc.docId, edit);
                }

                const fresh = await M().problem.get(auth.domainId, pdoc.docId);
                this.response.body = {
                    id: fresh?.docId ?? pdoc.docId,
                    pid: fresh?.pid,
                    title: fresh?.title,
                };
            } catch (e: any) {
                this.response.status = 400;
                this.response.body = {
                    error: 'IMPORT_FAILED',
                    message: e?.message || String(e),
                };
            } finally {
                try {
                    await fs.remove(tmpdir);
                } catch {
                    // ignore cleanup errors
                }
            }
        }
    }

    ctx.Route('rest_problems', '/rest-api/problems', RestProblemUploadHandler);

    class RestProblemDetailHandler extends Handler {
        @param('id', Types.String)
        async get(domainId: string, id: string) {
            const auth = await requireAuth.call(this, jwtSecret);
            if (!auth) return;
            if (!requirePerm.call(this, auth.udoc, 'PERM_VIEW_PROBLEM')) return;

            const pdoc = await M().problem.get(auth.domainId, id);
            if (!pdoc) {
                this.response.status = 404;
                this.response.body = { error: 'NOT_FOUND', message: 'Problem not found' };
                return;
            }
            this.response.body = {
                id: pdoc.docId || pdoc.pid,
                pid: pdoc.pid,
                title: pdoc.title,
                content: pdoc.content || '',
                difficulty: pdoc.difficulty,
                tag: pdoc.tag || [],
                timeLimit: pdoc.timeLimit || 1000,
                memoryLimit: pdoc.memoryLimit || 256,
                accepted: pdoc.accepted || 0,
                submission: pdoc.submission || 0,
                samples: pdoc.samples || [],
            };
        }
    }
    ctx.Route('rest_problem_detail', '/rest-api/problems/:id', RestProblemDetailHandler);

    ctx.Route('rest_submissions', '/rest-api/submissions', class extends Handler {
        async get() {
            const auth = await requireAuth.call(this, jwtSecret);
            if (!auth) return;
            if (!requirePerm.call(this, auth.udoc, 'PERM_VIEW_RECORD')) return;

            const { page = '1', pageSize = '20' } = this.request.query as any;
            const skip = (parseInt(page) - 1) * parseInt(pageSize);
            const limit = Math.min(parseInt(pageSize), 100);
            const rdocs = await M().record.getMulti(auth.domainId, { uid: auth.uid })
                .sort({ _id: -1 }).skip(skip).limit(limit).toArray();
            const total = await M().record.count(auth.domainId, { uid: auth.uid });
            this.response.body = {
                items: rdocs.map(r => ({
                    id: r._id.toString(),
                    pid: r.pid,
                    status: r.status || 'unknown',
                    score: r.score || 0,
                    time: r.time || 0,
                    memory: r.memory || 0,
                    language: r.language || 'unknown',
                    submitAt: r._id.getTimestamp(),
                })),
                page: parseInt(page),
                pageSize: limit,
                total,
                totalPages: Math.ceil(total / limit),
            };
        }
    });

    class RestSubmissionDetailHandler extends Handler {
        @param('id', Types.String)
        async get(domainId: string, id: string) {
            const auth = await requireAuth.call(this, jwtSecret);
            if (!auth) return;
            if (!requirePerm.call(this, auth.udoc, 'PERM_VIEW_RECORD')) return;

            const rdoc = await M().record.get(auth.domainId, id);
            if (!rdoc) {
                this.response.status = 404;
                this.response.body = { error: 'NOT_FOUND', message: 'Submission not found' };
                return;
            }
            this.response.body = {
                id: rdoc._id.toString(),
                pid: rdoc.pid,
                status: rdoc.status || 'unknown',
                score: rdoc.score || 0,
                time: rdoc.time || 0,
                memory: rdoc.memory || 0,
                language: rdoc.language || 'unknown',
                submitAt: rdoc._id.getTimestamp(),
                detail: rdoc.detail || null,
            };
        }
    }
    ctx.Route('rest_submission_detail', '/rest-api/submissions/:id', RestSubmissionDetailHandler);

    class RestContestsListHandler extends Handler {
        async get() {
            const auth = await requireAuth.call(this, jwtSecret);
            if (!auth) return;
            if (!requirePerm.call(this, auth.udoc, 'PERM_VIEW_CONTEST')) return;

            const { page = '1', pageSize = '20' } = this.request.query as any;
            const skip = (parseInt(page) - 1) * parseInt(pageSize);
            const limit = Math.min(parseInt(pageSize), 100);
            const cdocs = await M().contest.getMulti(auth.domainId, contestOnlyQuery)
                .sort({ startAt: -1 }).skip(skip).limit(limit).toArray();
            const total = await M().contest.count(auth.domainId, contestOnlyQuery);
            this.response.body = {
                items: cdocs.map(c => ({
                    id: c._id.toString(),
                    title: c.title,
                    description: c.description || '',
                    rule: c.rule,
                    startAt: c.startAt,
                    endAt: c.endAt,
                    status: c.status || 'upcoming',
                })),
                page: parseInt(page),
                pageSize: limit,
                total,
                totalPages: Math.ceil(total / limit),
            };
        }
    }

    const CONTEST_CREATE_RULES = new Set(['acm', 'oi', 'ioi', 'ledo']);

    class RestContestCreateHandler extends RestContestsListHandler {
        async post() {
            const auth = await requireAuth.call(this, jwtSecret);
            if (!auth) return;
            if (!requirePerm.call(this, auth.udoc, 'PERM_CREATE_CONTEST')) return;

            const b = (this.request.body || {}) as any;
            const title = b.title != null ? String(b.title).trim() : '';
            const content = b.content != null ? String(b.content) : '';
            const rule = b.rule != null ? String(b.rule).trim() : '';
            const beginAt = b.beginAt != null ? new Date(b.beginAt) : null;
            const endAt = b.endAt != null ? new Date(b.endAt) : null;
            const pids = Array.isArray(b.pids) ? b.pids.map((x: any) => Number(x)).filter((n: number) => Number.isFinite(n)) : [];

            if (!title) {
                badRequest.call(this, 'title is required');
                return;
            }
            if (!CONTEST_CREATE_RULES.has(rule)) {
                badRequest.call(this, 'rule must be one of: acm, oi, ioi, ledo');
                return;
            }
            if (!beginAt || Number.isNaN(beginAt.getTime())) {
                badRequest.call(this, 'beginAt must be a valid ISO8601 datetime');
                return;
            }
            if (!endAt || Number.isNaN(endAt.getTime())) {
                badRequest.call(this, 'endAt must be a valid ISO8601 datetime');
                return;
            }
            if (!pids.length) {
                badRequest.call(this, 'pids must be a non-empty array of problem docIds');
                return;
            }

            const rated = parseBoolLoose(b.rated, false);
            const pin = parseBoolLoose(b.pin, false);
            const duration = b.duration !== undefined && b.duration !== null && b.duration !== ''
                ? Number(b.duration)
                : undefined;
            const assignIn = Array.isArray(b.assign) ? b.assign.map((x: any) => String(x).trim()).filter(Boolean) : [];
            const langs = Array.isArray(b.langs) ? b.langs.map((x: any) => String(x)).filter(Boolean) : undefined;
            const allowViewCode = b.allowViewCode !== undefined ? parseBoolLoose(b.allowViewCode, false) : undefined;
            const allowPrint = b.allowPrint !== undefined ? parseBoolLoose(b.allowPrint, false) : undefined;
            const score = normalizeScoreRecord(b.score);
            const lockAt = b.lockAt != null && b.lockAt !== '' ? new Date(b.lockAt) : undefined;
            const balloon = b.balloon != null && typeof b.balloon === 'object' && !Array.isArray(b.balloon)
                ? b.balloon
                : undefined;

            const assignUids: string[] = [];
            for (const uname of assignIn) {
                const u = await M().user.getByUname(auth.domainId, uname);
                if (!u) {
                    badRequest.call(this, `Unknown assign username: ${uname}`);
                    return;
                }
                assignUids.push(String(u._id));
            }

            const extra: Record<string, any> = {
                ...(duration !== undefined && Number.isFinite(duration) ? { duration } : {}),
                ...(assignUids.length ? { assign: assignUids } : {}),
                ...(langs?.length ? { langs } : {}),
                ...(allowViewCode !== undefined ? { allowViewCode } : {}),
                ...(allowPrint !== undefined ? { allowPrint } : {}),
                ...(score ? { score } : {}),
                ...(lockAt && !Number.isNaN(lockAt.getTime()) ? { lockAt } : {}),
                ...(balloon ? { balloon } : {}),
                ...(pin ? { pin } : {}),
            };

            try {
                const docId = await M().contest.add(
                    auth.domainId,
                    title,
                    content,
                    auth.uid,
                    rule,
                    beginAt,
                    endAt,
                    pids,
                    rated,
                    extra,
                );
                this.response.body = { id: docId.toString(), title };
            } catch (e: any) {
                badRequest.call(this, e?.message || String(e));
            }
        }
    }

    ctx.Route('rest_contests', '/rest-api/contests', RestContestCreateHandler);

    class RestHomeworkListHandler extends Handler {
        async get() {
            const auth = await requireAuth.call(this, jwtSecret);
            if (!auth) return;
            if (!requirePerm.call(this, auth.udoc, 'PERM_VIEW_HOMEWORK')) return;

            const { page = '1', pageSize = '20' } = this.request.query as any;
            const skip = (parseInt(page) - 1) * parseInt(pageSize);
            const limit = Math.min(parseInt(pageSize), 100);
            const cdocs = await M().contest.getMulti(auth.domainId, homeworkQuery)
                .sort({ startAt: -1 }).skip(skip).limit(limit).toArray();
            const total = await M().contest.count(auth.domainId, homeworkQuery);
            this.response.body = {
                items: cdocs.map(c => ({
                    id: c._id.toString(),
                    title: c.title,
                    description: c.description || '',
                    rule: c.rule,
                    startAt: c.startAt,
                    endAt: c.endAt,
                    status: c.status || 'upcoming',
                })),
                page: parseInt(page),
                pageSize: limit,
                total,
                totalPages: Math.ceil(total / limit),
            };
        }
    }

    class RestHomeworkCreateHandler extends RestHomeworkListHandler {
        async post() {
            const auth = await requireAuth.call(this, jwtSecret);
            if (!auth) return;
            const PERM = M().builtin.PERM;
            if (!auth.udoc.hasPerm(PERM.PERM_CREATE_HOMEWORK) && !auth.udoc.hasPerm(PERM.PERM_CREATE_CONTEST)) {
                this.response.status = 403;
                this.response.body = {
                    error: 'FORBIDDEN',
                    message: 'Missing permission: PERM_CREATE_HOMEWORK or PERM_CREATE_CONTEST',
                };
                return;
            }

            const b = (this.request.body || {}) as any;
            const title = b.title != null ? String(b.title).trim() : '';
            const content = b.content != null ? String(b.content) : '';
            const beginAt = b.beginAt != null ? new Date(b.beginAt) : null;
            const endAt = b.endAt != null ? new Date(b.endAt) : null;
            const pids = Array.isArray(b.pids) ? b.pids.map((x: any) => Number(x)).filter((n: number) => Number.isFinite(n)) : [];

            if (!title) {
                badRequest.call(this, 'title is required');
                return;
            }
            if (!beginAt || Number.isNaN(beginAt.getTime())) {
                badRequest.call(this, 'beginAt must be a valid ISO8601 datetime');
                return;
            }
            if (!endAt || Number.isNaN(endAt.getTime())) {
                badRequest.call(this, 'endAt must be a valid ISO8601 datetime');
                return;
            }
            if (!pids.length) {
                badRequest.call(this, 'pids must be a non-empty array of problem docIds');
                return;
            }

            const duration = b.duration !== undefined && b.duration !== null && b.duration !== ''
                ? Number(b.duration)
                : undefined;
            const assignIn = Array.isArray(b.assign) ? b.assign.map((x: any) => String(x).trim()).filter(Boolean) : [];
            const langs = Array.isArray(b.langs) ? b.langs.map((x: any) => String(x)).filter(Boolean) : undefined;
            const penaltySinceRaw = b.penaltySince != null && b.penaltySince !== ''
                ? new Date(b.penaltySince)
                : null;
            const penaltySince = penaltySinceRaw && !Number.isNaN(penaltySinceRaw.getTime())
                ? penaltySinceRaw
                : beginAt;
            let penaltyRules: Record<string, number> = {};
            if (b.penaltyRules != null && typeof b.penaltyRules === 'object' && !Array.isArray(b.penaltyRules)) {
                penaltyRules = { ...b.penaltyRules };
            }
            const score = normalizeScoreRecord(b.score);

            const assignUids: string[] = [];
            for (const uname of assignIn) {
                const u = await M().user.getByUname(auth.domainId, uname);
                if (!u) {
                    badRequest.call(this, `Unknown assign username: ${uname}`);
                    return;
                }
                assignUids.push(String(u._id));
            }

            const extra: Record<string, any> = {
                penaltySince,
                penaltyRules,
                ...(duration !== undefined && Number.isFinite(duration) ? { duration } : {}),
                ...(assignUids.length ? { assign: assignUids } : {}),
                ...(langs?.length ? { langs } : {}),
                ...(score ? { score } : {}),
            };

            try {
                const docId = await M().contest.add(
                    auth.domainId,
                    title,
                    content,
                    auth.uid,
                    'homework',
                    beginAt,
                    endAt,
                    pids,
                    false,
                    extra,
                );
                this.response.body = { id: docId.toString(), title };
            } catch (e: any) {
                badRequest.call(this, e?.message || String(e));
            }
        }
    }

    ctx.Route('rest_homework', '/rest-api/homework', RestHomeworkCreateHandler);

    class RestContestDetailHandler extends Handler {
        @param('id', Types.String)
        async get(domainId: string, id: string) {
            const auth = await requireAuth.call(this, jwtSecret);
            if (!auth) return;
            if (!requirePerm.call(this, auth.udoc, 'PERM_VIEW_CONTEST')) return;

            const cdoc = await findContest(auth.domainId, id);
            if (!cdoc || cdoc.rule === 'homework') {
                this.response.status = 404;
                this.response.body = { error: 'NOT_FOUND', message: 'Contest not found' };
                return;
            }
            this.response.body = {
                id: cdoc._id.toString(),
                title: cdoc.title,
                description: cdoc.description || '',
                rule: cdoc.rule,
                startAt: cdoc.startAt,
                endAt: cdoc.endAt,
                status: cdoc.status || 'upcoming',
                problems: cdoc.pids || [],
            };
        }
    }
    ctx.Route('rest_contest_detail', '/rest-api/contests/:id', RestContestDetailHandler);

    class RestHomeworkDetailHandler extends Handler {
        @param('id', Types.String)
        async get(domainId: string, id: string) {
            const auth = await requireAuth.call(this, jwtSecret);
            if (!auth) return;
            if (!requirePerm.call(this, auth.udoc, 'PERM_VIEW_HOMEWORK')) return;

            const cdoc = await findContest(auth.domainId, id);
            if (!cdoc || cdoc.rule !== 'homework') {
                this.response.status = 404;
                this.response.body = { error: 'NOT_FOUND', message: 'Homework not found' };
                return;
            }
            this.response.body = {
                id: cdoc._id.toString(),
                title: cdoc.title,
                description: cdoc.description || '',
                rule: cdoc.rule,
                startAt: cdoc.startAt,
                endAt: cdoc.endAt,
                status: cdoc.status || 'upcoming',
                problems: cdoc.pids || [],
            };
        }
    }
    ctx.Route('rest_homework_detail', '/rest-api/homework/:id', RestHomeworkDetailHandler);

    class RestContestProblemsHandler extends Handler {
        @param('id', Types.String)
        async get(domainId: string, id: string) {
            const auth = await requireAuth.call(this, jwtSecret);
            if (!auth) return;
            if (!requirePerm.call(this, auth.udoc, 'PERM_VIEW_CONTEST')) return;

            const cdoc = await findContest(auth.domainId, id);
            if (!cdoc || cdoc.rule === 'homework') {
                this.response.status = 404;
                this.response.body = { error: 'NOT_FOUND', message: 'Contest not found' };
                return;
            }
            const pids = cdoc.pids || [];
            const problems = await Promise.all(
                pids.map((pid: number) => M().problem.get(auth.domainId, pid)),
            );
            this.response.body = {
                items: problems.filter(Boolean).map((p: any) => ({
                    id: p.docId || p.pid,
                    pid: p.pid,
                    title: p.title,
                    difficulty: p.difficulty,
                    tag: p.tag || [],
                })),
            };
        }
    }
    ctx.Route('rest_contest_problems', '/rest-api/contests/:id/problems', RestContestProblemsHandler);

    class RestHomeworkProblemsHandler extends Handler {
        @param('id', Types.String)
        async get(domainId: string, id: string) {
            const auth = await requireAuth.call(this, jwtSecret);
            if (!auth) return;
            if (!requirePerm.call(this, auth.udoc, 'PERM_VIEW_HOMEWORK')) return;

            const cdoc = await findContest(auth.domainId, id);
            if (!cdoc || cdoc.rule !== 'homework') {
                this.response.status = 404;
                this.response.body = { error: 'NOT_FOUND', message: 'Homework not found' };
                return;
            }
            const pids = cdoc.pids || [];
            const problems = await Promise.all(
                pids.map((pid: number) => M().problem.get(auth.domainId, pid)),
            );
            this.response.body = {
                items: problems.filter(Boolean).map((p: any) => ({
                    id: p.docId || p.pid,
                    pid: p.pid,
                    title: p.title,
                    difficulty: p.difficulty,
                    tag: p.tag || [],
                })),
            };
        }
    }
    ctx.Route('rest_homework_problems', '/rest-api/homework/:id/problems', RestHomeworkProblemsHandler);

    class RestTrainingCreateHandler extends Handler {
        async post() {
            const auth = await requireAuth.call(this, jwtSecret);
            if (!auth) return;
            if (!requirePerm.call(this, auth.udoc, 'PERM_CREATE_TRAINING')) return;

            const b = (this.request.body || {}) as any;
            const title = b.title != null ? String(b.title).trim() : '';
            const content = b.content != null ? String(b.content) : '';
            const description = b.description != null ? String(b.description) : '';
            const pin = b.pin !== undefined && b.pin !== null && b.pin !== ''
                ? Number(b.pin)
                : 0;
            const dagIn = b.dag;

            if (!title) {
                badRequest.call(this, 'title is required');
                return;
            }
            if (!Array.isArray(dagIn) || dagIn.length === 0) {
                badRequest.call(this, 'dag must be a non-empty array');
                return;
            }

            const ids = new Set<number>();
            for (const node of dagIn) {
                const nid = Number(node?._id);
                if (!Number.isFinite(nid)) {
                    badRequest.call(this, 'each dag node requires a numeric _id');
                    return;
                }
                if (ids.has(nid)) {
                    badRequest.call(this, 'dag _id values must be unique');
                    return;
                }
                ids.add(nid);
            }

            const nodes: { _id: number; title: string; requireNids: number[]; pids: number[] }[] = [];
            for (const node of dagIn) {
                const _id = Number(node._id);
                const nTitle = node.title != null ? String(node.title).trim() : '';
                if (!nTitle) {
                    badRequest.call(this, `dag node ${_id}: title is required`);
                    return;
                }
                if (!Array.isArray(node.requireNids)) {
                    badRequest.call(this, `dag node ${_id}: requireNids must be an array`);
                    return;
                }
                if (!Array.isArray(node.pids)) {
                    badRequest.call(this, `dag node ${_id}: pids must be an array`);
                    return;
                }
                if (!node.pids.length) {
                    badRequest.call(this, `dag node ${_id}: pids must contain at least one problem`);
                    return;
                }
                const requireNids = Array.from(new Set(
                    node.requireNids.map((x: any) => Number(x)).filter((n: number) => Number.isFinite(n)),
                ));
                for (const r of requireNids) {
                    if (!ids.has(r)) {
                        badRequest.call(this, `dag node ${_id}: requireNids references unknown _id ${r}`);
                        return;
                    }
                }
                const rawPids = node.pids.map((x: any) => Number(x)).filter((n: number) => Number.isFinite(n));
                if (rawPids.length !== node.pids.length) {
                    badRequest.call(this, `dag node ${_id}: pids must be numeric problem ids`);
                    return;
                }
                nodes.push({ _id, title: nTitle, requireNids, pids: rawPids });
            }

            if (trainingDagHasCycle(nodes)) {
                badRequest.call(this, 'dag has circular dependencies in requireNids');
                return;
            }

            const transformed: { _id: number; title: string; requireNids: number[]; pids: number[] }[] = [];
            for (const n of nodes) {
                const docIds: number[] = [];
                for (const pid of n.pids) {
                    const pdoc = await M().problem.get(auth.domainId, pid);
                    if (!pdoc) {
                        badRequest.call(this, `Unknown problem docId ${pid} in dag node ${n._id}`);
                        return;
                    }
                    docIds.push(pdoc.docId);
                }
                transformed.push({
                    _id: n._id,
                    title: n.title,
                    requireNids: n.requireNids,
                    pids: Array.from(new Set(docIds)),
                });
            }

            try {
                const docId = await M().training.add(
                    auth.domainId,
                    title,
                    content,
                    auth.uid,
                    transformed,
                    description,
                    Number.isFinite(pin) ? pin : 0,
                );
                this.response.body = { id: docId.toString?.() ? docId.toString() : String(docId), title };
            } catch (e: any) {
                badRequest.call(this, e?.message || String(e));
            }
        }
    }

    ctx.Route('rest_trainings', '/rest-api/trainings', RestTrainingCreateHandler);
}
