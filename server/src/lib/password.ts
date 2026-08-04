import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Формат зберігання: `<salt-hex>:<hash-hex>`.
 *
 * Модуль навмисно не залежить від config — його використовує скрипт
 * hash-password, який запускається ДО того, як env узагалі заповнений.
 */

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;

  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
