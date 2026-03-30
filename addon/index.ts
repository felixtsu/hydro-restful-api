import { createHmac, timingSafeEqual } from 'crypto';
import { Context, Handler, LoginError, param, Schema, Types } from 'hydrooj';

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';

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

/** Handler 的 this.ctx 未 inject model，与官方 handler 一致用 global.Hydro.model */
function M() {
    return (global as any).Hydro.model as Record<string, any>;
}

async function readJsonBodyIfNeeded(req: any): Promise<any | null> {
    // Koa usually populates req.body via middleware, but we also support a fallback.
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

export const Config = Schema.object({
    jwtSecret: Schema.string().role('secret').default(JWT_SECRET),
});

export function apply(ctx: Context, config: ReturnType<typeof Config>) {
    const jwtSecret = config.jwtSecret || JWT_SECRET;

    // Login
    ctx.Route('rest_login', '/rest-api/login', class extends Handler {
        async get() {
            // Avoid credentials in URL query string.
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

    // Problems list
    ctx.Route('rest_problems', '/rest-api/problems', class extends Handler {
        async get() {
            const user = verifyToken(this.request.headers.authorization, jwtSecret);
            if (!user) {
                this.response.status = 401;
                this.response.body = { error: 'UNAUTHORIZED', message: 'Invalid or missing token' };
                return;
            }
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
            const pdocs = await M().problem.getMulti('system', query)
                .skip(skip).limit(limit).toArray();
            const total = await M().problem.count('system', query);
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
    });

    class RestProblemDetailHandler extends Handler {
        @param('id', Types.String)
        async get(domainId: string, id: string) {
            const user = verifyToken(this.request.headers.authorization, jwtSecret);
            if (!user) {
                this.response.status = 401;
                this.response.body = { error: 'UNAUTHORIZED', message: 'Invalid or missing token' };
                return;
            }
            const pdoc = await M().problem.get('system', id);
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
            const user = verifyToken(this.request.headers.authorization, jwtSecret);
            if (!user) {
                this.response.status = 401;
                this.response.body = { error: 'UNAUTHORIZED', message: 'Invalid or missing token' };
                return;
            }
            const { page = '1', pageSize = '20' } = this.request.query as any;
            const skip = (parseInt(page) - 1) * parseInt(pageSize);
            const limit = Math.min(parseInt(pageSize), 100);
            const rdocs = await M().record.getMulti('system', { uid: user.uid })
                .sort({ _id: -1 }).skip(skip).limit(limit).toArray();
            const total = await M().record.count('system', { uid: user.uid });
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
            const user = verifyToken(this.request.headers.authorization, jwtSecret);
            if (!user) {
                this.response.status = 401;
                this.response.body = { error: 'UNAUTHORIZED', message: 'Invalid or missing token' };
                return;
            }
            const rdoc = await M().record.get('system', id);
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

    const contestOnlyQuery = { rule: { $ne: 'homework' } };
    const homeworkQuery = { rule: 'homework' };

    ctx.Route('rest_contests', '/rest-api/contests', class extends Handler {
        async get() {
            const user = verifyToken(this.request.headers.authorization, jwtSecret);
            if (!user) {
                this.response.status = 401;
                this.response.body = { error: 'UNAUTHORIZED', message: 'Invalid or missing token' };
                return;
            }
            const { page = '1', pageSize = '20' } = this.request.query as any;
            const skip = (parseInt(page) - 1) * parseInt(pageSize);
            const limit = Math.min(parseInt(pageSize), 100);
            const cdocs = await M().contest.getMulti('system', contestOnlyQuery)
                .sort({ startAt: -1 }).skip(skip).limit(limit).toArray();
            const total = await M().contest.count('system', contestOnlyQuery);
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
    });

    ctx.Route('rest_homework', '/rest-api/homework', class extends Handler {
        async get() {
            const user = verifyToken(this.request.headers.authorization, jwtSecret);
            if (!user) {
                this.response.status = 401;
                this.response.body = { error: 'UNAUTHORIZED', message: 'Invalid or missing token' };
                return;
            }
            const { page = '1', pageSize = '20' } = this.request.query as any;
            const skip = (parseInt(page) - 1) * parseInt(pageSize);
            const limit = Math.min(parseInt(pageSize), 100);
            const cdocs = await M().contest.getMulti('system', homeworkQuery)
                .sort({ startAt: -1 }).skip(skip).limit(limit).toArray();
            const total = await M().contest.count('system', homeworkQuery);
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
    });

    class RestContestDetailHandler extends Handler {
        @param('id', Types.String)
        async get(domainId: string, id: string) {
            const user = verifyToken(this.request.headers.authorization, jwtSecret);
            if (!user) {
                this.response.status = 401;
                this.response.body = { error: 'UNAUTHORIZED', message: 'Invalid or missing token' };
                return;
            }
            const cdoc = await M().contest.get('system', id);
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
            const user = verifyToken(this.request.headers.authorization, jwtSecret);
            if (!user) {
                this.response.status = 401;
                this.response.body = { error: 'UNAUTHORIZED', message: 'Invalid or missing token' };
                return;
            }
            const cdoc = await M().contest.get('system', id);
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
            const user = verifyToken(this.request.headers.authorization, jwtSecret);
            if (!user) {
                this.response.status = 401;
                this.response.body = { error: 'UNAUTHORIZED', message: 'Invalid or missing token' };
                return;
            }
            const cdoc = await M().contest.get('system', id);
            if (!cdoc || cdoc.rule === 'homework') {
                this.response.status = 404;
                this.response.body = { error: 'NOT_FOUND', message: 'Contest not found' };
                return;
            }
            const pids = cdoc.pids || [];
            const problems = await Promise.all(
                pids.map((pid: number) => M().problem.get('system', pid)),
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
            const user = verifyToken(this.request.headers.authorization, jwtSecret);
            if (!user) {
                this.response.status = 401;
                this.response.body = { error: 'UNAUTHORIZED', message: 'Invalid or missing token' };
                return;
            }
            const cdoc = await M().contest.get('system', id);
            if (!cdoc || cdoc.rule !== 'homework') {
                this.response.status = 404;
                this.response.body = { error: 'NOT_FOUND', message: 'Homework not found' };
                return;
            }
            const pids = cdoc.pids || [];
            const problems = await Promise.all(
                pids.map((pid: number) => M().problem.get('system', pid)),
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
}
