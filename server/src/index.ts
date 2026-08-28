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
 *
 * Кешування розділене навмисно: файли в /assets мають хеш у назві
 * (Vite), тому їх можна кешувати назавжди — новий білд це просто інший
 * файл. index.html хешу не має, і без явного no-cache мобільні браузери
 * (особливо Safari) кешують його агресивно й показують стару версію
 * застосунку днями, навіть після деплою нового образу.
 */
if (isProd) {
  app.use('/assets/*', async (c, next) => {
    c.header('Cache-Control', 'public, max-age=31536000, immutable');
    await next();
  });
  app.use('/assets/*', serveStatic({ root: './web' }));
  app.get('/favicon.svg', serveStatic({ path: './web/favicon.svg' }));
  // SPA-фолбек: усе, що не /api, віддає index.html.
  app.get('*', async (c, next) => {
    c.header('Cache-Control', 'no-cache, must-revalidate');
    await next();
  });
  app.get('*', serveStatic({ path: './web/index.html' }));
}

const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(`a7smart слухає на :${info.port} (${config.NODE_ENV})`);
});

startPoller();

/** Коректне завершення: Traefik має встигнути зняти контейнер з балансування. */
async function shutdown(signal: string) {
  console.log(`${signal} — завершення роботи`);
  stopPoller();
  server.close();
  await sql.end().catch(() => undefined);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
