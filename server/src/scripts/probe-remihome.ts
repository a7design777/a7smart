/**
 * Розвідка Remihome — аналог tuya:probe для другого провайдера.
 *
 *   npm run remihome:probe
 *
 * Логіниться в портал, тягне каталог, зони та поточні статуси й показує
 * їхню структуру. API недокументований, тому форму відповідей неможливо
 * знати наперед — саме за цим виводом пишеться нормалізація.
 *
 * Повний JSON зберігається у .artifacts/remihome-*.json (каталог у
 * .gitignore), щоб не засмічувати термінал 15 кілобайтами.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { remihomeGet, isRemihomeConfigured, RemihomeError } from '../remihome/client.js';

const OUT_DIR = '.artifacts';

/** Показує форму об'єкта, а не весь вміст: ключі та типи значень. */
function describe(value: unknown, depth = 0): string {
  const pad = '  '.repeat(depth + 1);

  if (Array.isArray(value)) {
    if (value.length === 0) return 'порожній масив';
    return `масив з ${value.length}, перший елемент:\n${describe(value[0], depth)}`;
  }

  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => {
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          return `${pad}${k}: { ${Object.keys(v).join(', ')} }`;
        }
        if (Array.isArray(v)) {
          return `${pad}${k}: масив[${v.length}]`;
        }
        return `${pad}${k}: ${JSON.stringify(v)}`;
      })
      .join('\n');
  }

  return `${pad}${JSON.stringify(value)}`;
}

async function dump(label: string, path: string) {
  console.log('─'.repeat(70));
  console.log(`${label}   (${path})`);
  try {
    const data = await remihomeGet<unknown>(path);
    await writeFile(
      `${OUT_DIR}/remihome-${label}.json`,
      JSON.stringify(data, null, 2),
      'utf8',
    );
    console.log(describe(data));
    console.log(`\n  → повний JSON: ${OUT_DIR}/remihome-${label}.json`);
  } catch (err) {
    console.log(`  ПОМИЛКА: ${err instanceof Error ? err.message : err}`);
  }
}

async function main() {
  if (!isRemihomeConfigured()) {
    console.error('Remihome не налаштований. Додайте в .env:');
    console.error('  REMIHOME_EMAIL=...');
    console.error('  REMIHOME_PASSWORD=...');
    console.error('  REMIHOME_INSTALLATION=43879');
    process.exit(1);
  }

  await mkdir(OUT_DIR, { recursive: true });

  await dump('devices', '/devices?includeHidden=false');
  await dump('status', '/status?includeHidden=false');
  await dump('zones', '/zones');
  await dump('home', '/home');
  await dump('hvac', '/homeHvacState');

  console.log('─'.repeat(70));
  console.log('\nГотово. Надішліть вміст .artifacts/remihome-devices.json та');
  console.log('remihome-status.json — за ними напишу нормалізацію.');
}

main().catch((err) => {
  if (err instanceof RemihomeError) {
    console.error(`\nRemihome: ${err.message}`);
    console.error('Перевірте REMIHOME_EMAIL / REMIHOME_PASSWORD та');
    console.error('REMIHOME_INSTALLATION (число зі шляху порталу).');
  } else {
    console.error(err);
  }
  process.exit(1);
});
