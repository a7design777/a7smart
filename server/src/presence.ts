import type { ApartmentRow, DeviceRow } from './db/queries.js';

/**
 * Який пристрій квартири вважати датчиком світла.
 *
 * Явний вибір користувача — головний. Без нього береться пристрій, що
 * живиться від мережі: розетка, потім камера, потім термостат. Вибір
 * стабільний (за порядком у списку), а не «перший, що зараз онлайн», — інакше
 * датчик «стрибав» би й ховав справжні відключення.
 */
const PREFERRED_KINDS = ['switch', 'camera', 'climate'] as const;

export function pickPowerDevice(
  apartment: Pick<ApartmentRow, 'id' | 'power_device_id'>,
  devices: readonly DeviceRow[],
): { device: DeviceRow; auto: boolean } | null {
  const mine = devices.filter((d) => d.apartment_id === apartment.id);

  if (apartment.power_device_id) {
    const chosen = mine.find((d) => d.external_id === apartment.power_device_id);
    if (chosen) return { device: chosen, auto: false };
  }

  for (const kind of PREFERRED_KINDS) {
    const device = mine.find((d) => d.kind === kind);
    if (device) return { device, auto: true };
  }
  return null;
}
