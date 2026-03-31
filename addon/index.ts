import { Context, Schema } from 'hydrooj';
import { JWT_DEFAULT_SECRET, registerRestApiRoutes } from './routes';

export const Config = Schema.object({
    jwtSecret: Schema.string().role('secret').default(JWT_DEFAULT_SECRET),
});

export function apply(ctx: Context, config: ReturnType<typeof Config>) {
    const jwtSecret = config.jwtSecret || JWT_DEFAULT_SECRET;
    registerRestApiRoutes(ctx, jwtSecret);
}
