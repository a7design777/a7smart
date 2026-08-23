/**
 * Простий міграційний раннер: виконує всі .sql з ../migrations по порядку
 * і запам'ятовує застосовані у таблиці _migrations.
 *
 * Запускається з локальної машини (`npm run db:migrate`), а не з контейнера —
 * так само, як у a7cms: Neon спільний, сервер не навантажується.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from './client.js';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

async function main() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name       TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `);

  const applied = new Set(
    (await sql<{ name: string }[]>`SELECT name FROM _migrations`).map((r) => r.name),
  );

  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`  пропущено ${file} (вже застосовано)`);
      continue;
    }
    const content = await readFile(join(migrationsDir, file), 'utf8');
    // D1 REST /query виконує весь текст (кілька `;`-розділених
    // стейтментів) одним викликом — окремої транзакції тут немає,
    // але для одноразового застосування схеми це не критично.
    await sql.unsafe(content);
    await sql`INSERT INTO _migrations (name) VALUES (${file})`;
    console.log(`  застосовано ${file}`);
  }

  console.log('Міграції завершено.');
  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await sql.end();
  process.exit(1);
});
