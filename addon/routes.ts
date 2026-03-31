import { createHmac, timingSafeEqual } from 'crypto';
import { Context, Handler, LoginError, param, query, Types } from 'hydrooj';

export const JWT_DEFAULT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';

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

/** Validates Bearer JWT, loads udoc via M().user.getById(); sets 401 on this and returns null if invalid. */
export async function requireAuth(self: Handler, jwtSecret: string): Promise<{
    uid: number;
    uname: string;
    domainId: string;
    udoc: any;
} | null> {
    const user = verifyToken(self.request.headers.authorization, jwtSecret);
    if (!user) {
        self.response.status = 401;
        self.response.body = { error: 'UNAUTHORIZED', message: 'Invalid or missing token' };
        return null;
    }
    const udoc = await M().user.getById(user.domainId, user.uid);
    if (!udoc) {
        self.response.status = 401;
        self.response.body = { error: 'UNAUTHORIZED', message: 'Invalid or missing token' };
        return null;
    }
    return { ...user, udoc };
}

export function requirePerm(udoc: any, perm: bigint): boolean {
    return udoc.hasPerm(perm);
}

const contestOnlyQuery = { rule: { $ne: 'homework' } };
const homeworkQuery = { rule: 'homework' };

export function registerRestApiRoutes(ctx: Context, jwtSecret: string) {
    // Login handler
    class RestLoginHandler extends Handler {
        async get() {
            this.response.body = {
                error: 'BAD_REQUEST',
                message: 'Use POST /rest-api/login with JSON body {username, password}',
            };
            this.response.status = 400;
        }

        @param('username', Types.String)
        @param('password', Types.String)
        async post(domainId: string, username?: string, password?: string) {
            let src = (this.request.body || this.request.query) as any;
            if (!src || typeof src !== 'object') {
                src = await readJsonBodyIfNeeded(this.request);
            }
            const un = username ?? src?.username;
            const pw = password ?? src?.password;

            if (!un || !pw) {
                this.response.body = { error: 'BAD_REQUEST', message: 'username and password required' };
                this.response.status = 400;
                return;
            }

            const udoc = await M().user.getByEmail(domainId, un)
                || await M().user.getByUname(domainId, un);
            if (!udoc) {
                this.response.body = { error: 'INVALID_CREDENTIALS', message: 'Invalid username or password' };
                this.response.status = 401;
                return;
            }
            try {
                await udoc.checkPassword(pw);
            } catch (e) {
                if (!(e instanceof LoginError)) throw e;
                this.response.body = { error: 'INVALID_CREDENTIALS', message: 'Invalid username or password' };
                this.response.status = 401;
                return;
            }
            const token = signToken(
                { uid: udoc._id, uname: udoc.uname, domainId },
                jwtSecret,
                7 * 24 * 3600,
            );
            this.response.body = { token, uid: udoc._id, uname: udoc.uname };
        }
    }
    ctx.Route('rest_login', '/rest-api/login', RestLoginHandler);

    const P = () => M().builtin.PERM;

    class RestProblemsHandler extends Handler {
        @query('page', Types.PositiveInt, true)
        @query('pageSize', Types.PositiveInt, true)
        @query('tag', Types.String, true)
        @query('difficulty', Types.String, true)
        @query('keyword', Types.String, true)
        async get(domainId: string, page = 1, pageSize = 20, tag = '', difficulty = '', keyword = '') {
            const auth = await requireAuth(this, jwtSecret);
            if (!auth) return;
            if (!requirePerm(auth.udoc, P().PERM_VIEW_PROBLEM)) {
                this.response.status = 403;
                this.response.body = { error: 'FORBIDDEN', message: 'Missing permission: PERM_VIEW_PROBLEM' };
                return;
            }

            const q: any = {};
            if (tag) q.tag = tag;
            if (difficulty) q.difficulty = parseInt(difficulty);
            if (keyword) {
                q.$or = [
                    { title: { $regex: keyword, $options: 'i' } },
                    { pid: { $regex: keyword, $options: 'i' } },
                ];
            }

            const skip = (page - 1) * pageSize;
            const limit = Math.min(pageSize, 100);

            const pdocs = await M().problem.getMulti(domainId, q)
                .skip(skip).limit(limit).toArray();
            const total = await M().problem.count(domainId, q);

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
                page,
                pageSize: limit,
                total,
                totalPages: Math.ceil(total / limit),
            };
        }

        async post(domainId: string) {
            const auth = await requireAuth(this, jwtSecret);
            if (!auth) return;
            if (!requirePerm(auth.udoc, P().PERM_CREATE_PROBLEM)) {
                this.response.status = 403;
                this.response.body = { error: 'FORBIDDEN', message: 'Missing permission: PERM_CREATE_PROBLEM' };
                return;
            }
            this.response.status = 501;
            this.response.body = { error: 'NOT_IMPLEMENTED', message: 'Not implemented' };
        }
    }
    ctx.Route('rest_problems', '/rest-api/problems', RestProblemsHandler);

    class RestProblemDetailHandler extends Handler {
        @param('id', Types.String)
        async get(domainId: string, id: string) {
            const auth = await requireAuth(this, jwtSecret);
            if (!auth) return;
            if (!requirePerm(auth.udoc, P().PERM_VIEW_PROBLEM)) {
                this.response.status = 403;
                this.response.body = { error: 'FORBIDDEN', message: 'Missing permission: PERM_VIEW_PROBLEM' };
                return;
            }

            const pdoc = await M().problem.get(domainId, id);
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

    class RestSubmissionsHandler extends Handler {
        @query('page', Types.PositiveInt, true)
        @query('pageSize', Types.PositiveInt, true)
        async get(domainId: string, page = 1, pageSize = 20) {
            const auth = await requireAuth(this, jwtSecret);
            if (!auth) return;
            if (!requirePerm(auth.udoc, P().PERM_VIEW_RECORD)) {
                this.response.status = 403;
                this.response.body = { error: 'FORBIDDEN', message: 'Missing permission: PERM_VIEW_RECORD' };
                return;
            }

            const skip = (page - 1) * pageSize;
            const limit = Math.min(pageSize, 100);

            const rdocs = await M().record.getMulti(domainId, { uid: auth.uid })
                .sort({ _id: -1 }).skip(skip).limit(limit).toArray();
            const total = await M().record.count(domainId, { uid: auth.uid });

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
                page,
                pageSize: limit,
                total,
                totalPages: Math.ceil(total / limit),
            };
        }
    }
    ctx.Route('rest_submissions', '/rest-api/submissions', RestSubmissionsHandler);

    class RestSubmissionDetailHandler extends Handler {
        @param('id', Types.String)
        async get(domainId: string, id: string) {
            const auth = await requireAuth(this, jwtSecret);
            if (!auth) return;
            if (!requirePerm(auth.udoc, P().PERM_VIEW_RECORD)) {
                this.response.status = 403;
                this.response.body = { error: 'FORBIDDEN', message: 'Missing permission: PERM_VIEW_RECORD' };
                return;
            }

            const rdoc = await M().record.get(domainId, id);
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

    class RestContestsHandler extends Handler {
        @query('page', Types.PositiveInt, true)
        @query('pageSize', Types.PositiveInt, true)
        async get(domainId: string, page = 1, pageSize = 20) {
            const auth = await requireAuth(this, jwtSecret);
            if (!auth) return;
            if (!requirePerm(auth.udoc, P().PERM_VIEW_CONTEST)) {
                this.response.status = 403;
                this.response.body = { error: 'FORBIDDEN', message: 'Missing permission: PERM_VIEW_CONTEST' };
                return;
            }

            const skip = (page - 1) * pageSize;
            const limit = Math.min(pageSize, 100);

            const cdocs = await M().contest.getMulti(domainId, contestOnlyQuery)
                .sort({ startAt: -1 }).skip(skip).limit(limit).toArray();
            const total = await M().contest.count(domainId, contestOnlyQuery);

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
                page,
                pageSize: limit,
                total,
                totalPages: Math.ceil(total / limit),
            };
        }

        async post(domainId: string) {
            const auth = await requireAuth(this, jwtSecret);
            if (!auth) return;
            if (!requirePerm(auth.udoc, P().PERM_CREATE_CONTEST)) {
                this.response.status = 403;
                this.response.body = { error: 'FORBIDDEN', message: 'Missing permission: PERM_CREATE_CONTEST' };
                return;
            }
            this.response.status = 501;
            this.response.body = { error: 'NOT_IMPLEMENTED', message: 'Not implemented' };
        }
    }
    ctx.Route('rest_contests', '/rest-api/contests', RestContestsHandler);

    class RestHomeworkHandler extends Handler {
        @query('page', Types.PositiveInt, true)
        @query('pageSize', Types.PositiveInt, true)
        async get(domainId: string, page = 1, pageSize = 20) {
            const auth = await requireAuth(this, jwtSecret);
            if (!auth) return;
            if (!requirePerm(auth.udoc, P().PERM_VIEW_HOMEWORK)) {
                this.response.status = 403;
                this.response.body = { error: 'FORBIDDEN', message: 'Missing permission: PERM_VIEW_HOMEWORK' };
                return;
            }

            const skip = (page - 1) * pageSize;
            const limit = Math.min(pageSize, 100);

            const cdocs = await M().contest.getMulti(domainId, homeworkQuery)
                .sort({ startAt: -1 }).skip(skip).limit(limit).toArray();
            const total = await M().contest.count(domainId, homeworkQuery);

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
                page,
                pageSize: limit,
                total,
                totalPages: Math.ceil(total / limit),
            };
        }

        async post(domainId: string) {
            const auth = await requireAuth(this, jwtSecret);
            if (!auth) return;
            const permObj = P();
            const ok = requirePerm(auth.udoc, permObj.PERM_CREATE_HOMEWORK)
                || requirePerm(auth.udoc, permObj.PERM_CREATE_CONTEST);
            if (!ok) {
                this.response.status = 403;
                this.response.body = {
                    error: 'FORBIDDEN',
                    message: 'Missing permission: PERM_CREATE_HOMEWORK or PERM_CREATE_CONTEST',
                };
                return;
            }
            this.response.status = 501;
            this.response.body = { error: 'NOT_IMPLEMENTED', message: 'Not implemented' };
        }
    }
    ctx.Route('rest_homework', '/rest-api/homework', RestHomeworkHandler);

    class RestContestDetailHandler extends Handler {
        @param('id', Types.String)
        async get(domainId: string, id: string) {
            const auth = await requireAuth(this, jwtSecret);
            if (!auth) return;
            if (!requirePerm(auth.udoc, P().PERM_VIEW_CONTEST)) {
                this.response.status = 403;
                this.response.body = { error: 'FORBIDDEN', message: 'Missing permission: PERM_VIEW_CONTEST' };
                return;
            }

            const cdoc = await M().contest.get(domainId, id);
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
            const auth = await requireAuth(this, jwtSecret);
            if (!auth) return;
            if (!requirePerm(auth.udoc, P().PERM_VIEW_HOMEWORK)) {
                this.response.status = 403;
                this.response.body = { error: 'FORBIDDEN', message: 'Missing permission: PERM_VIEW_HOMEWORK' };
                return;
            }

            const cdoc = await M().contest.get(domainId, id);
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
            const auth = await requireAuth(this, jwtSecret);
            if (!auth) return;
            if (!requirePerm(auth.udoc, P().PERM_VIEW_CONTEST)) {
                this.response.status = 403;
                this.response.body = { error: 'FORBIDDEN', message: 'Missing permission: PERM_VIEW_CONTEST' };
                return;
            }

            const cdoc = await M().contest.get(domainId, id);
            if (!cdoc || cdoc.rule === 'homework') {
                this.response.status = 404;
                this.response.body = { error: 'NOT_FOUND', message: 'Contest not found' };
                return;
            }

            const pids = cdoc.pids || [];
            const problems = await Promise.all(
                pids.map(pid => M().problem.get(domainId, pid)),
            );

            this.response.body = {
                items: problems.filter(Boolean).map(p => ({
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
            const auth = await requireAuth(this, jwtSecret);
            if (!auth) return;
            if (!requirePerm(auth.udoc, P().PERM_VIEW_HOMEWORK)) {
                this.response.status = 403;
                this.response.body = { error: 'FORBIDDEN', message: 'Missing permission: PERM_VIEW_HOMEWORK' };
                return;
            }

            const cdoc = await M().contest.get(domainId, id);
            if (!cdoc || cdoc.rule !== 'homework') {
                this.response.status = 404;
                this.response.body = { error: 'NOT_FOUND', message: 'Homework not found' };
                return;
            }

            const pids = cdoc.pids || [];
            const problems = await Promise.all(
                pids.map(pid => M().problem.get(domainId, pid)),
            );

            this.response.body = {
                items: problems.filter(Boolean).map(p => ({
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

    class RestTrainingsPostHandler extends Handler {
        async post(domainId: string) {
            const auth = await requireAuth(this, jwtSecret);
            if (!auth) return;
            if (!requirePerm(auth.udoc, P().PERM_CREATE_TRAINING)) {
                this.response.status = 403;
                this.response.body = { error: 'FORBIDDEN', message: 'Missing permission: PERM_CREATE_TRAINING' };
                return;
            }
            this.response.status = 501;
            this.response.body = { error: 'NOT_IMPLEMENTED', message: 'Not implemented' };
        }
    }
    ctx.Route('rest_trainings_post', '/rest-api/trainings', RestTrainingsPostHandler);
}
