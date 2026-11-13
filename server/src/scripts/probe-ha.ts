/**
 * Розвідка Home Assistant — аналог tuya:probe / remihome:probe.
 *
 *   npm run ha:probe
 *
 * Лише читає: каталог пристроїв HA (з виробником — за ним фільтруються
 * службові) і те, як кожен пристрій виглядає після нормалізації.
 * Повний дамп станів — у .artifacts/ha-states.json.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { isHaConfigured, haGetStates, HaError } from '../ha/client.js';
import { listHaDevices } from '../ha/devices.js';
import { normalizeHa } from '../ha/normalize.js';

async function main() {
  if (!isHaConfigured()) {
    console.error('Home Assistant не налаштований. Додайте в .env:');
    console.error('  HA_URL=https://ha.example.com   (або http://192.168.1.58:8123 локально)');
    console.error('  HA_TOKEN=...   (профіль HA → Безпека → довгостроковий токен)');
    process.exit(1);
  }

  await mkdir('.artifacts', { recursive: true });

  const states = await haGetStates();
  await writeFile('.artifacts/ha-states.json', JSON.stringify(states, null, 2), 'utf8');
  console.log(`Сутностей у HA: ${states.length}  (дамп: .artifacts/ha-states.json)`);

  const byId = new Map(states.map((s) => [s.entity_id, s]));
  const devices = await listHaDevices(byId);
  console.log(`Пристроїв після фільтра: ${devices.length}\n`);

  for (const device of devices) {
    const n = normalizeHa(device, byId);
    console.log('─'.repeat(70));
    const tuya = device.tuyaId ? `  tuya:${device.tuyaId}` : '';
    console.log(
      `${device.name}   [${device.manufacturer ?? 'без виробника'}]  ${n.online ? 'online' : 'OFFLINE'}${tuya}`,
    );
    for (const m of n.metrics) console.log(`  ${m.key.padEnd(18)} ${m.value} ${m.unit}   (${m.code})`);
    for (const s of n.states) console.log(`  ${s.alarm ? '⚠ ' : ''}${s.label}`);
  }
}

main().catch((err) => {
  console.error(err instanceof HaError ? `\nHA: ${err.message}` : err);
  process.exit(1);
});
