import { createHmac, timingSafeEqual } from 'node:crypto';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Context, MiddlewareHandler } from 'hono';
import { config, isProd } from './config.js';

export { verifyPassword } from './lib/password.js';

/**
 * Автентифікація навмисно проста: один спільний пароль на сім'ю,
 * без реєстрації та ролей. Мультитенантності в системі немає за задумом.
 *
 * scrypt з node:crypto замість bcrypt — на 1 GB RAM зайва нативна
 * залежність не потрібна.
 */

const COOKIE_NAME = 'a7smart_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 днів

function sign(payload: string): string {
  return createHmac('sha256', config.SESSION_SECRET).update(payload).digest('hex');
}

function issueToken(): string {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const payload = String(expiresAt);
  return `${payload}.${sign(payload)}`;
}

function isTokenValid(token: string | undefined): boolean {
  if (!token) return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;

  const expected = Buffer.from(sign(payload), 'hex');
  const actual = Buffer.from(signature, 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;

  const expiresAt = Number(payload);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

export function startSession(c: Context): void {
  setCookie(c, COOKIE_NAME, issueToken(), {
    httpOnly: true,
    secure: isProd,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export function endSession(c: Context): void {
  deleteCookie(c, COOKIE_NAME, { path: '/' });
}

/** Захищає /api/*. Віддає 401 JSON — фронтенд сам вирішує, куди редиректити. */
export const requireAuth: MiddlewareHandler = async (c, next) => {
  if (!isTokenValid(getCookie(c, COOKIE_NAME))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  await next();
};
