import { Router } from 'express';

export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

healthRouter.get('/ready', (_req, res) => {
  // Fase 1 wires a DB pool check here; for now readiness == liveness.
  res.status(200).json({ status: 'ready' });
});
