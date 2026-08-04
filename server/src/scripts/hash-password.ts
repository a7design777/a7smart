/**
 * Генератор значення для APP_PASSWORD_HASH.
 *
 *   npx tsx server/src/scripts/hash-password.ts 'ваш-пароль'
 */
import { hashPassword } from '../lib/password.js';

const password = process.argv[2];

if (!password) {
  console.error("Використання: tsx hash-password.ts '<пароль>'");
  process.exit(1);
}

console.log(hashPassword(password));
