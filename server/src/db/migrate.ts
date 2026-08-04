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
  await sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

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
    await sql.begin(async (tx) => {
      await tx.unsafe(content);
      await tx`INSERT INTO _migrations (name) VALUES (${file})`;
    });
    console.log(`  застосовано ${file}`);
  }

  console.log('Міграції завершено.');
  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await sql.end({ timeout: 5 });
  process.exit(1);
});
