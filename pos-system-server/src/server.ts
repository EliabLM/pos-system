import { createApp } from './app.js';
import { env } from './config/env.js';
import type { Server } from 'node:http';

function start(): Server {
  const app = createApp();
  const server = app.listen(env.PORT, () => {
    // eslint-disable-next-line no-console -- startup banner only
    console.log(`pos-system-server listening on :${env.PORT} (${env.NODE_ENV})`);
  });

  // Graceful shutdown (goldberg 2.6).
  const shutdown = (signal: string) => {
    // eslint-disable-next-line no-console
    console.log(`${signal} received, closing server…`);
    server.close(() => {
      // eslint-disable-next-line no-console
      console.log('Server closed.');
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return server;
}

// Only boot when run directly (not when imported by tests).
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  start();
}
