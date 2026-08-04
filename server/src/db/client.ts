import postgres from 'postgres';
import { config } from '../config.js';

/**
 * Neon вимагає TLS. Пул тримаємо маленьким: сервер живе на 1 vCPU
 * поруч із n8n, flowise та a7cms — з'єднання тут дешевші за пам'ять.
 */
export const sql = postgres(config.DATABASE_URL, {
  ssl: 'require',
  max: 3,
  idle_timeout: 20,
  connect_timeout: 10,
});
