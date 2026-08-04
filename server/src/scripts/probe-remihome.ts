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
import {
  remihomeGet,
  remihomeRequest,
  isRemihomeConfigured,
  RemihomeError,
} from '../remihome/client.js';

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

  // Спершу GET; якщо шлях його не приймає — пробуємо POST. Який саме
  // метод очікує портал, з боку клієнта наперед не видно.
  let data: unknown;
  try {
    data = await remihomeGet<unknown>(path);
  } catch (getErr) {
    console.log(`  GET  → ${getErr instanceof Error ? getErr.message : getErr}`);
    try {
      data = await remihomeRequest<unknown>(path, 'POST');
      console.log('  POST → успішно');
    } catch (postErr) {
      console.log(`  POST → ${postErr instanceof Error ? postErr.message : postErr}`);
      return;
    }
  }

  await writeFile(`${OUT_DIR}/remihome-${label}.json`, JSON.stringify(data, null, 2), 'utf8');
  console.log(describe(data));
  console.log(`\n  → повний JSON: ${OUT_DIR}/remihome-${label}.json`);
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

  // Статус окремого пристрою — саме цей шлях видно в мережевій панелі
  // порталу. Якщо спільний /status не віддається, читатимемо поштучно.
  try {
    const devices = await remihomeGet<Array<{ code: string; name: string }>>(
      '/devices?includeHidden=false',
    );
    const first = devices[0];
    if (first) {
      console.log(`\n(перевіряємо на пристрої «${first.name.trim()}»)`);
      await dump('device-status', `/devices/${first.code}/status`);
    }
  } catch {
    /* каталог уже не дістали вище — повторювати помилку немає сенсу */
  }

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
