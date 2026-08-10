import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { pinoHttp, type Options } from 'pino-http';
import { env } from './config/env.js';
import { errorHandler } from './shared/infra/http/errorHandler.js';
import { healthRouter } from './health/health.route.js';

// Separate app from server so supertest can import `app` without binding a port
// (goldberg 1.4 — server ≠ app).
export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));
  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      max: 300,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );
  // pino-http attaches `req.log` and logs every request with a generated id.
  const pinoOpts: Options = { level: env.LOG_LEVEL, autoLogging: true };
  app.use(pinoHttp(pinoOpts));

  app.use('/api/v1', healthRouter);

  // 404 → standard error shape.
  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  // Error-handling middleware — must be last. Express 5 auto-catches async
  // rejections; this centralizes DomainError → HTTP mapping.
  app.use(errorHandler);

  return app;
}
