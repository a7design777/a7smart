/**
 * Діагностика стану бази.
 *
 *   npm run status
 *
 * Показує, що реально зібралося: скільки пристроїв синхронізовано,
 * як вони розподілені по квартирах і чи пишеться історія.
 */
import { sql } from '../db/client.js';

const [devices] = await sql<[{ count: number }]>`SELECT count(*)::int FROM devices`;
const [readings] = await sql<[{ count: number }]>`SELECT count(*)::int FROM readings`;
const [apartments] = await sql<[{ count: number }]>`SELECT count(*)::int FROM apartments`;

console.log(`Квартир:   ${apartments.count}`);
console.log(`Пристроїв: ${devices.count}`);
console.log(`Записів історії: ${readings.count}`);

const byProvider = await sql<{ provider: string; count: number }[]>`
  SELECT provider, count(*)::int FROM devices GROUP BY provider ORDER BY count DESC
`;
console.log('\nЗа джерелом:');
for (const row of byProvider) {
  console.log(`  ${row.provider.padEnd(10)} ${row.count}`);
}

const byKind = await sql<{ kind: string; count: number }[]>`
  SELECT kind, count(*)::int FROM devices GROUP BY kind ORDER BY count DESC
`;
console.log('\nЗа типом:');
for (const row of byKind) {
  console.log(`  ${row.kind.padEnd(10)} ${row.count}`);
}

const unassigned = await sql<{ count: number }[]>`
  SELECT count(*)::int FROM devices WHERE apartment_id IS NULL
`;
if ((unassigned[0]?.count ?? 0) > 0) {
  console.log(`\nБез квартири: ${unassigned[0]?.count} — прив'яжіть їх, інакше`);
  console.log("вкладки квартир будуть порожні (див. DEPLOY.md, крок 5).");
}

const topKeys = await sql<{ key: string; count: number }[]>`
  SELECT key, count(*)::int FROM readings GROUP BY key ORDER BY count DESC
`;
if (topKeys.length > 0) {
  console.log('\nІсторія за показниками:');
  for (const row of topKeys) {
    console.log(`  ${row.key.padEnd(12)} ${row.count}`);
  }
}

await sql.end();
