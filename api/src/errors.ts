/**
 * One error shape for the whole API, matching what the Angular client's
 * apiErrorMessage() already reads: `{ error, message }`.
 */
export class AppError extends Error {
    constructor(
        readonly statusCode: number,
        readonly code: string,
        message: string,
        readonly details?: unknown
    ) {
        super(message);
        this.name = 'AppError';
    }
}

export const badRequest = (message: string, details?: unknown) =>
    new AppError(400, 'BAD_REQUEST', message, details);

export const unauthorized = (message = 'Not signed in') =>
    new AppError(401, 'UNAUTHORIZED', message);

export const forbidden = (message = 'Not allowed') => new AppError(403, 'FORBIDDEN', message);

export const notFound = (what: string) => new AppError(404, 'NOT_FOUND', `${what} not found`);

export const conflict = (message: string, details?: unknown) =>
    new AppError(409, 'CONFLICT', message, details);

export const tooManyRequests = (message: string) =>
    new AppError(429, 'TOO_MANY_REQUESTS', message);
