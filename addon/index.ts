import { Context, Schema } from 'hydrooj';
import { registerRestApiRoutes } from './routes';

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';

export const Config = Schema.object({
    jwtSecret: Schema.string().role('secret').default(JWT_SECRET),
});

export function apply(ctx: Context, config: ReturnType<typeof Config>) {
    const jwtSecret = config.jwtSecret || JWT_SECRET;
    registerRestApiRoutes(ctx, jwtSecret);
}
