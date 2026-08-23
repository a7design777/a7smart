import { z } from 'zod';

/**
 * Конфіг валідується на старті. Сервіс має падати одразу при відсутньому
 * ключі, а не через годину на першому запиті до Tuya.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  // Tuya IoT Platform → Cloud Project → Overview / Authorization Key
  TUYA_BASE_URL: z.string().url().default('https://openapi.tuyaeu.com'),
  TUYA_ACCESS_KEY: z.string().min(1, 'TUYA_ACCESS_KEY порожній'),
  TUYA_SECRET_KEY: z.string().min(1, 'TUYA_SECRET_KEY порожній'),
  // UID акаунта Smart Life: Cloud Project → Devices → Link App Account
  TUYA_UID: z.string().min(1, 'TUYA_UID порожній'),

  // Cloudflare D1 — REST API поза Workers: акаунт, ідентифікатор бази
  // та токен із правом D1 Edit (My Profile → API Tokens).
  CF_ACCOUNT_ID: z.string().min(1, 'CF_ACCOUNT_ID порожній'),
  CF_D1_DATABASE_ID: z.string().min(1, 'CF_D1_DATABASE_ID порожній'),
  CF_D1_API_TOKEN: z.string().min(1, 'CF_D1_API_TOKEN порожній'),

  // Remihome (Remica) — необов'язковий провайдер. Якщо не заповнений,
  // просто не вмикається; Tuya від цього не залежить.
  REMIHOME_EMAIL: z.string().email().optional(),
  REMIHOME_PASSWORD: z.string().min(1).optional(),
  // Число у шляху порталу: proxy.remihome.es/<ЦЕ>/RemicaHome/...
  REMIHOME_INSTALLATION: z.string().min(1).optional(),

  // Один спільний пароль на сім'ю — мультитенантності не передбачено.
  APP_PASSWORD_HASH: z.string().min(1, 'APP_PASSWORD_HASH порожній'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET має бути ≥32 символів'),

  // Інтервал фонового поллера станів, мс. Прямо впливає на витрату квоти
  // Tuya API — не знижувати без потреби.
  POLL_INTERVAL_MS: z.coerce.number().int().min(60_000).default(300_000),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  console.error(`Некоректна конфігурація:\n${issues}`);
  process.exit(1);
}

export const config = parsed.data;
export const isProd = config.NODE_ENV === 'production';
