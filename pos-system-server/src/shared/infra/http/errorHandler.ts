import type { Request, Response, NextFunction } from 'express';
import { DomainError } from '../../domain/errors.js';

interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
    correlationId?: string;
    details?: unknown;
  };
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof DomainError) {
    const body: ErrorResponseBody = {
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    };
    res.status(err.statusCode).json(body);
    return;
  }

  // Non-domain errors: never leak internals.
  const body: ErrorResponseBody = {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    },
  };
  res.status(500).json(body);
}
