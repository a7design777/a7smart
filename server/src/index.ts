import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { config, isProd } from './config.js';
import { api } from './routes/api.js';
import { startPoller, stopPoller } from './poller.js';
import { sql } from './db/client.js';

const app = new Hono();

app.use('*', logger());
app.use('*', secureHeaders());

app.route('/api', api);

/**
 * Статика зібраного React. Той самий контейнер віддає і API, і фронтенд —
 * так на Traefik потрібен лише один роутер, а в пам'яті один процес.
 */
if (isProd) {
  app.use('/assets/*', serveStatic({ root: './web' }));
  app.get('/favicon.svg', serveStatic({ path: './web/favicon.svg' }));
  // SPA-фолбек: усе, що не /api, віддає index.html.
  app.get('*', serveStatic({ path: './web/index.html' }));
}

const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(`a7smart слухає на :${info.port} (${config.NODE_ENV})`);
});

startPoller();

/**
 * Коректне завершення: Traefik має встигнути зняти контейнер з балансування,
 * а поллер — не залишити висіти з'єднання до Neon.
 */
async function shutdown(signal: string) {
  console.log(`${signal} — завершення роботи`);
  stopPoller();
  server.close();
  await sql.end({ timeout: 5 }).catch(() => undefined);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
