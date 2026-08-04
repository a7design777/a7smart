/**
 * Розвідка Tuya-акаунта. Запускати ПЕРШИМ, до будь-якої іншої роботи:
 *
 *   npm run tuya:probe
 *
 * Друкує всі пристрої та їхні сирі datapoint-коди. Ці коди неможливо
 * вгадати наперед — вони різні для кожної моделі, і саме за ними
 * заповнюється мапінг у `tuya/normalize.ts`.
 */
import { listDevices, getDeviceStatus, allocateCameraStream } from '../tuya/devices.js';
import { TuyaApiError } from '../tuya/client.js';

async function main() {
  const devices = await listDevices();

  if (devices.length === 0) {
    console.log('Пристроїв не знайдено. Перевірте, чи прив\'язаний акаунт Smart Life');
    console.log('у Cloud Project → Devices → Link App Account, і чи збігається TUYA_UID.');
    return;
  }

  console.log(`Знайдено пристроїв: ${devices.length}\n`);

  for (const d of devices) {
    console.log('─'.repeat(70));
    console.log(`${d.name}`);
    console.log(`  id:       ${d.id}`);
    console.log(`  category: ${d.category}${d.product_name ? `  (${d.product_name})` : ''}`);
    console.log(`  online:   ${d.online ? 'так' : 'НІ'}`);

    try {
      const status = await getDeviceStatus(d.id);
      console.log('  datapoints:');
      for (const s of status) {
        console.log(`    ${s.code.padEnd(24)} = ${JSON.stringify(s.value)}`);
      }
    } catch (err) {
      console.log(`  datapoints: помилка — ${err instanceof Error ? err.message : err}`);
    }

    // Камери перевіряємо окремо: наявність потоку — головне питання
    // після заміни icSee на Tuya.
    if (d.category === 'sp' || d.category === 'dghsxj') {
      try {
        const stream = await allocateCameraStream(d.id, 'hls');
        console.log(`  hls:      OK (${stream.url.slice(0, 60)}…)`);
      } catch (err) {
        console.log(`  hls:      НЕДОСТУПНО — ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  console.log('─'.repeat(70));
  console.log('\nСкопіюйте потрібні коди в server/src/tuya/normalize.ts.');
}

main().catch((err) => {
  if (err instanceof TuyaApiError && err.isAuthProblem) {
    console.error(`\nПомилка авторизації Tuya (код ${err.code}): ${err.tuyaMessage}`);
    console.error('Найімовірніші причини:');
    console.error('  1. Скінчився термін IoT Core — продовжити в Cloud → My Services');
    console.error('  2. Невірні TUYA_ACCESS_KEY / TUYA_SECRET_KEY');
    console.error('  3. Невірний регіон у TUYA_BASE_URL (має збігатися з ЦОД проєкту)');
  } else {
    console.error(err);
  }
  process.exit(1);
});
