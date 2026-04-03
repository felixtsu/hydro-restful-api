import { createHmac, timingSafeEqual } from 'crypto';
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

// Auth middleware: validates Bearer JWT, loads udoc. Returns null and sends 401 if invalid.
async function requireAuth(this: Handler, jwtSecret: string): Promise<{ uid: number; uname: string; domainId: string; udoc: any } | null> {
    const auth = this.request.headers.authorization;
    const token = verifyToken(auth, jwtSecret);
    if (!token) {
        this.response.status = 401;
        this.response.body = { error: 'UNAUTHORIZED', message: 'Invalid or missing token' };
        return null;
    }
    const udoc = await loadUser(token.domainId, token.uid);
    if (!udoc) {
        this.response.status = 401;
        this.response.body = { error: 'UNAUTHORIZED', message: 'Invalid or missing token' };
        return null;
    }
    return { uid: token.uid, uname: token.uname, domainId: token.domainId, udoc };
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

    ctx.Route('rest_problems', '/rest-api/problems', class extends Handler {
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

        async post() {
            const auth = await requireAuth.call(this, jwtSecret);
            if (!auth) return;
            if (!requirePerm.call(this, auth.udoc, 'PERM_CREATE_PROBLEM')) return;
            this.response.status = 501;
            this.response.body = { error: 'NOT_IMPLEMENTED' };
        }
    });

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

    ctx.Route('rest_contests', '/rest-api/contests', class extends Handler {
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

        async post() {
            const auth = await requireAuth.call(this, jwtSecret);
            if (!auth) return;
            if (!requirePerm.call(this, auth.udoc, 'PERM_CREATE_CONTEST')) return;
            this.response.status = 501;
            this.response.body = { error: 'NOT_IMPLEMENTED' };
        }
    });

    ctx.Route('rest_homework', '/rest-api/homework', class extends Handler {
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
            this.response.status = 501;
            this.response.body = { error: 'NOT_IMPLEMENTED' };
        }
    });

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

    ctx.Route('rest_trainings_post', '/rest-api/trainings', class extends Handler {
        async post() {
            const auth = await requireAuth.call(this, jwtSecret);
            if (!auth) return;
            if (!requirePerm.call(this, auth.udoc, 'PERM_CREATE_TRAINING')) return;
            this.response.status = 501;
            this.response.body = { error: 'NOT_IMPLEMENTED' };
        }
    });
}
