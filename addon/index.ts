import { Context, Handler, route, Types } from 'hydrooj';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';

function verifyToken(auth: string | undefined) {
    if (!auth?.startsWith('Bearer ')) return null;
    try {
        return jwt.verify(auth.slice(7), JWT_SECRET) as { uid: number; uname: string; domainId: string };
    } catch {
        return null;
    }
}

// Login handler
class RestLoginHandler extends Handler {
    async get() {
        const { username, password } = this.request.query as any;
        if (!username || !password) {
            this.response.body = { error: 'BAD_REQUEST', message: 'username and password required' };
            this.response.status = 400;
            return;
        }
        const udoc = await this.ctx.model.user.getByUname('system', username)
            || await this.ctx.model.user.getByEmail('system', username);
        if (!udoc) {
            this.response.body = { error: 'INVALID_CREDENTIALS', message: 'Invalid username or password' };
            this.response.status = 401;
            return;
        }
        try {
            const valid = await this.ctx.model.user.verifyPassword(udoc, password);
            if (!valid) throw new Error('Invalid');
        } catch {
            this.response.body = { error: 'INVALID_CREDENTIALS', message: 'Invalid username or password' };
            this.response.status = 401;
            return;
        }
        const token = jwt.sign(
            { uid: udoc._id, uname: udoc.uname, domainId: 'system' },
            JWT_SECRET,
            { expiresIn: '7d' }
        );
        this.response.body = { token, uid: udoc._id, uname: udoc.uname };
    }
}

// Problems list handler
class RestProblemsHandler extends Handler {
    async get() {
        const user = verifyToken(this.request.headers.authorization);
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
        const p = parseInt(page);
        const ps = Math.min(parseInt(pageSize), 100);
        const pdocs = await this.ctx.model.problem.getMulti('system', query)
            .skip((p - 1) * ps).limit(ps).toArray();
        const total = await this.ctx.model.problem.count('system', query);
        this.response.body = {
            items: pdocs.map(pdoc => ({
                id: pdoc.docId || pdoc.pid,
                pid: pdoc.pid,
                title: pdoc.title,
                difficulty: pdoc.difficulty,
                tag: pdoc.tag || [],
                accepted: pdoc.accepted || 0,
                submission: pdoc.submission || 0,
            })),
            page: p,
            pageSize: ps,
            total,
            totalPages: Math.ceil(total / ps),
        };
    }
}

// Problem detail handler
class RestProblemDetailHandler extends Handler {
    async get() {
        const id = this.args.id;
        const user = verifyToken(this.request.headers.authorization);
        if (!user) {
            this.response.status = 401;
            this.response.body = { error: 'UNAUTHORIZED', message: 'Invalid or missing token' };
            return;
        }
        const pdoc = await this.ctx.model.problem.get('system', id);
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

// Submit handler
class RestSubmitHandler extends Handler {
    async post() {
        const user = verifyToken(this.request.headers.authorization);
        if (!user) {
            this.response.status = 401;
            this.response.body = { error: 'UNAUTHORIZED', message: 'Invalid or missing token' };
            return;
        }
        const { problemId, code, language = 'cpp' } = this.request.body as any;
        if (!problemId || !code) {
            this.response.body = { error: 'BAD_REQUEST', message: 'problemId and code required' };
            this.response.status = 400;
            return;
        }
        const pdoc = await this.ctx.model.problem.get('system', problemId);
        if (!pdoc) {
            this.response.status = 404;
            this.response.body = { error: 'NOT_FOUND', message: 'Problem not found' };
            return;
        }
        const rid = await this.ctx.model.record.submit('system', {
            pid: pdoc.pid,
            language,
            code,
            uid: user.uid,
        });
        this.response.body = { id: rid.toString(), status: 'pending' };
    }
}

// Submissions list handler
class RestSubmissionsHandler extends Handler {
    async get() {
        const user = verifyToken(this.request.headers.authorization);
        if (!user) {
            this.response.status = 401;
            this.response.body = { error: 'UNAUTHORIZED', message: 'Invalid or missing token' };
            return;
        }
        const { page = '1', pageSize = '20' } = this.request.query as any;
        const p = parseInt(page);
        const ps = Math.min(parseInt(pageSize), 100);
        const rdocs = await this.ctx.model.record.getMulti('system', { uid: user.uid })
            .sort({ _id: -1 }).skip((p - 1) * ps).limit(ps).toArray();
        const total = await this.ctx.model.record.count('system', { uid: user.uid });
        this.response.body = {
            items: rdocs.map(rdoc => ({
                id: rdoc._id.toString(),
                pid: rdoc.pid,
                status: rdoc.status || 'unknown',
                score: rdoc.score || 0,
                time: rdoc.time || 0,
                memory: rdoc.memory || 0,
                language: rdoc.language || 'unknown',
                submitAt: rdoc._id.getTimestamp(),
            })),
            page: p,
            pageSize: ps,
            total,
            totalPages: Math.ceil(total / ps),
        };
    }
}

// Submission detail handler
class RestSubmissionDetailHandler extends Handler {
    async get() {
        const id = this.args.id;
        const user = verifyToken(this.request.headers.authorization);
        if (!user) {
            this.response.status = 401;
            this.response.body = { error: 'UNAUTHORIZED', message: 'Invalid or missing token' };
            return;
        }
        const rdoc = await this.ctx.model.record.get('system', id);
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

// Contests list handler
class RestContestsHandler extends Handler {
    async get() {
        const user = verifyToken(this.request.headers.authorization);
        if (!user) {
            this.response.status = 401;
            this.response.body = { error: 'UNAUTHORIZED', message: 'Invalid or missing token' };
            return;
        }
        const { page = '1', pageSize = '20' } = this.request.query as any;
        const p = parseInt(page);
        const ps = Math.min(parseInt(pageSize), 100);
        const cdocs = await this.ctx.model.contest.getMulti('system', {})
            .sort({ startAt: -1 }).skip((p - 1) * ps).limit(ps).toArray();
        const total = await this.ctx.model.contest.count('system', {});
        this.response.body = {
            items: cdocs.map(cdoc => ({
                id: cdoc._id.toString(),
                title: cdoc.title,
                description: cdoc.description || '',
                rule: cdoc.rule || '',
                startAt: cdoc.startAt,
                endAt: cdoc.endAt,
                status: cdoc.status || 'upcoming',
                probs: cdoc.probs || [],
                pids: cdoc.pids || [],
            })),
            page: p,
            pageSize: ps,
            total,
            totalPages: Math.ceil(total / ps),
        };
    }
}

// Contest detail handler
// NOTE: contest.get() in Hydro expects docId (number), but our API returns ObjectId strings.
// Use findDoc directly with _id ObjectId to fix the lookup.
class RestContestDetailHandler extends Handler {
    async get() {
        const id = this.args.id;
        const user = verifyToken(this.request.headers.authorization);
        if (!user) {
            this.response.status = 401;
            this.response.body = { error: 'UNAUTHORIZED', message: 'Invalid or missing token' };
            return;
        }
        // Use findOne with ObjectId to find by _id string
        const cdoc = await this.ctx.db.collection('contest').findOne({ _id: this.ctx.model.contest.id(id) });
        if (!cdoc) {
            this.response.status = 404;
            this.response.body = { error: 'NOT_FOUND', message: 'Contest not found' };
            return;
        }
        this.response.body = {
            id: cdoc._id.toString(),
            title: cdoc.title,
            description: cdoc.description || '',
            rule: cdoc.rule || '',
            startAt: cdoc.startAt,
            endAt: cdoc.endAt,
            status: cdoc.status || 'upcoming',
            problems: cdoc.pids || [],
        };
    }
}

// Contest problems handler
class RestContestProblemsHandler extends Handler {
    async get() {
        const id = this.args.id;
        const user = verifyToken(this.request.headers.authorization);
        if (!user) {
            this.response.status = 401;
            this.response.body = { error: 'UNAUTHORIZED', message: 'Invalid or missing token' };
            return;
        }
        // Use findOne with ObjectId to find by _id string
        const cdoc = await this.ctx.db.collection('contest').findOne({ _id: this.ctx.model.contest.id(id) });
        if (!cdoc) {
            this.response.status = 404;
            this.response.body = { error: 'NOT_FOUND', message: 'Contest not found' };
            return;
        }
        const pids = cdoc.pids || [];
        const problems = await Promise.all(
            pids.map((pid: number) => this.ctx.model.problem.get('system', pid))
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

// Contest register handler
class RestContestRegisterHandler extends Handler {
    async post({ id }: { id: string }) {
        const user = verifyToken(this.request.headers.authorization);
        if (!user) {
            this.response.status = 401;
            this.response.body = { error: 'UNAUTHORIZED', message: 'Invalid or missing token' };
            return;
        }
        // Use findOne with ObjectId to find by _id string
        const cdoc = await this.ctx.db.collection('contest').findOne({ _id: this.ctx.model.contest.id(id) });
        if (!cdoc) {
            this.response.status = 404;
            this.response.body = { error: 'NOT_FOUND', message: 'Contest not found' };
            return;
        }
        await this.ctx.model.contest.join('system', id, user.uid);
        this.response.body = { success: true, message: 'Registered for contest' };
    }
}

// Homework detail handler (same ObjectId lookup issue as contests)
class RestHomeworkDetailHandler extends Handler {
    async get() {
        const id = this.args.id;
        const user = verifyToken(this.request.headers.authorization);
        if (!user) {
            this.response.status = 401;
            this.response.body = { error: 'UNAUTHORIZED', message: 'Invalid or missing token' };
            return;
        }
        const cdoc = await this.ctx.db.collection('contest').findOne({ _id: this.ctx.model.contest.id(id) });
        if (!cdoc || cdoc.rule !== 'homework') {
            this.response.status = 404;
            this.response.body = { error: 'NOT_FOUND', message: 'Homework not found' };
            return;
        }
        this.response.body = {
            id: cdoc._id.toString(),
            title: cdoc.title,
            description: cdoc.description || '',
            rule: cdoc.rule || 'homework',
            startAt: cdoc.startAt,
            endAt: cdoc.endAt,
            status: cdoc.status || 'upcoming',
            problems: cdoc.pids || [],
        };
    }
}

// Homework problems handler
class RestHomeworkProblemsHandler extends Handler {
    async get() {
        const id = this.args.id;
        const user = verifyToken(this.request.headers.authorization);
        if (!user) {
            this.response.status = 401;
            this.response.body = { error: 'UNAUTHORIZED', message: 'Invalid or missing token' };
            return;
        }
        const cdoc = await this.ctx.db.collection('contest').findOne({ _id: this.ctx.model.contest.id(id) });
        if (!cdoc || cdoc.rule !== 'homework') {
            this.response.status = 404;
            this.response.body = { error: 'NOT_FOUND', message: 'Homework not found' };
            return;
        }
        const pids = cdoc.pids || [];
        const problems = await Promise.all(
            pids.map((pid: number) => this.ctx.model.problem.get('system', pid))
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

// Homeworks list handler
class RestHomeworksHandler extends Handler {
    async get() {
        const user = verifyToken(this.request.headers.authorization);
        if (!user) {
            this.response.status = 401;
            this.response.body = { error: 'UNAUTHORIZED', message: 'Invalid or missing token' };
            return;
        }
        const { page = '1', pageSize = '20' } = this.request.query as any;
        const p = parseInt(page);
        const ps = Math.min(parseInt(pageSize), 100);
        const cdocs = await this.ctx.model.contest.getMulti('system', { rule: 'homework' })
            .sort({ startAt: -1 }).skip((p - 1) * ps).limit(ps).toArray();
        const total = await this.ctx.model.contest.count('system', { rule: 'homework' });
        this.response.body = {
            items: cdocs.map(cdoc => ({
                id: cdoc._id.toString(),
                title: cdoc.title,
                description: cdoc.description || '',
                rule: cdoc.rule || 'homework',
                startAt: cdoc.startAt,
                endAt: cdoc.endAt,
                status: cdoc.status || 'upcoming',
            })),
            page: p,
            pageSize: ps,
            total,
            totalPages: Math.ceil(total / ps),
        };
    }
}

// Submissions API (without /d/ domain prefix)
export function apply(ctx: Context) {
    ctx.Route('rest_login', '/api/login', RestLoginHandler);
    ctx.Route('rest_problems', '/api/problems', RestProblemsHandler);
    ctx.Route('rest_problem_detail', '/api/problems/:id', RestProblemDetailHandler);
    ctx.Route('rest_submit', '/api/submit', RestSubmitHandler);
    ctx.Route('rest_submissions', '/api/submissions', RestSubmissionsHandler);
    ctx.Route('rest_submission_detail', '/api/submissions/:id', RestSubmissionDetailHandler);
    ctx.Route('rest_homeworks', '/api/homework', RestHomeworksHandler);
    ctx.Route('rest_homework_detail', '/api/homework/:id', RestHomeworkDetailHandler);
    ctx.Route('rest_homework_problems', '/api/homework/:id/problems', RestHomeworkProblemsHandler);
    ctx.Route('rest_contests', '/api/contests', RestContestsHandler);
    ctx.Route('rest_contest_detail', '/api/contests/:id', RestContestDetailHandler);
    ctx.Route('rest_contest_problems', '/api/contests/:id/problems', RestContestProblemsHandler);
    ctx.Route('rest_contest_register', '/api/contests/:id/register', RestContestRegisterHandler);
}
