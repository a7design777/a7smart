import { listHomes, listHomeDevices, type TuyaDevice } from './tuya/devices.js';
import {
  listApartments,
  createApartment,
  getTuyaHomeLinks,
  linkTuyaHome,
  getDevicesByIds,
  assignUnassignedDevices,
  renameDeviceIfUnchanged,
} from './db/queries.js';

/**
 * Автоімпорт домогосподарств Tuya як квартир.
 *
 * Пристрої в Tuya живуть у «домогосподарствах» (homes), а квартири дашборда
 * заводяться вручну — тож нове домогосподарство (Boyarka) раніше лишало
 * свої пристрої «Без квартири», а квартира не з'являлась.
 *
 * Правила (вручну розкладене ніколи не перезаписується):
 *  - домогосподарство вже прив'язане → нові пристрої без квартири йдуть у неї;
 *  - не прив'язане: збіг назви з наявною квартирою → прив'язка;
 *    інакше квартира, що вже тримає БІЛЬШІСТЬ його пристроїв → прив'язка
 *    (так «Travel apt» стає «Travel», а не дублікатом);
 *    інакше створюється нова квартира з назвою домогосподарства;
 *  - квартиру видалили (apartment_id = NULL у tuya_homes) → не відтворювати.
 *
 * Назву пристрою беремо з home-списку (Smart Life) лише для тих, що щойно
 * прив'язуються: «без квартири» означає «ще не опрацьований вручну», а в БД
 * там лежить назва першої синхронізації («Security Camera 1»), тоді як у
 * Smart Life її вже змінили («Kitchen cam»).
 */

export interface HomeInput {
  id: string;
  name: string;
  devices: Array<{ id: string; name: string }>;
}

export interface DeviceRef {
  name: string;
  apartmentId: number | null;
}

export interface HomePlan {
  homeId: string;
  homeName: string;
  /** Нову прив'язку (рядок у tuya_homes) треба записати. */
  link: boolean;
  apartment: { kind: 'existing'; id: number } | { kind: 'create'; name: string };
  assign: string[];
  rename: Array<{ id: string; from: string; to: string }>;
}

/**
 * Чисте рішення без звернень до мережі й БД — саме тому його можна
 * перевірити на реальних даних без запису.
 *
 * @param linked undefined — домогосподарство ще не бачили; null — квартиру видалено
 */
export function planHome(
  home: HomeInput,
  refs: Map<string, DeviceRef>,
  linked: number | null | undefined,
  apartments: Array<{ id: number; name: string }>,
): HomePlan | null {
  if (linked === null) return null;

  const known = home.devices.filter((d) => refs.has(d.id));
  if (known.length === 0) return null;

  let apartment: HomePlan['apartment'];
  let link = false;

  if (typeof linked === 'number') {
    apartment = { kind: 'existing', id: linked };
  } else {
    link = true;
    const wanted = home.name.trim().toLowerCase();
    const byName = apartments.find((a) => a.name.trim().toLowerCase() === wanted);

    const counts = new Map<number, number>();
    for (const d of known) {
      const apt = refs.get(d.id)!.apartmentId;
      if (apt !== null) counts.set(apt, (counts.get(apt) ?? 0) + 1);
    }
    const [bestId, bestCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [0, 0];

    if (byName) apartment = { kind: 'existing', id: byName.id };
    else if (bestCount * 2 > known.length) apartment = { kind: 'existing', id: bestId };
    else apartment = { kind: 'create', name: home.name.trim() || `Tuya ${home.id}` };
  }

  const toAssign = known.filter((d) => refs.get(d.id)!.apartmentId === null);
  const assign = toAssign.map((d) => d.id);

  const rename = toAssign.flatMap((d) => {
    const from = refs.get(d.id)!.name;
    const to = d.name.trim();
    return to && to !== from.trim() ? [{ id: d.id, from, to }] : [];
  });

  return { homeId: home.id, homeName: home.name, link, apartment, assign, rename };
}

/**
 * Синхронізація домогосподарств. Викликається після оновлення каталогу
 * (раз на годину й з кнопки синхронізації).
 *
 * @param dryRun лише порахувати план, нічого не писати — для перевірки
 */
export async function syncTuyaHomes(opts: { dryRun?: boolean } = {}): Promise<HomePlan[]> {
  const homes = await listHomes();
  const links = await getTuyaHomeLinks();
  let apartments = await listApartments();
  const plans: HomePlan[] = [];

  for (const h of homes) {
    const homeId = String(h.home_id);
    let devices: TuyaDevice[];
    try {
      devices = await listHomeDevices(homeId);
    } catch (err) {
      console.error(`[tuya-homes] «${h.name}»: пристрої не прочитано:`, err instanceof Error ? err.message : err);
      continue;
    }

    const refs = await getDevicesByIds(devices.map((d) => d.id));
    const plan = planHome(
      { id: homeId, name: h.name, devices: devices.map((d) => ({ id: d.id, name: d.name })) },
      refs,
      links.get(homeId),
      apartments,
    );
    if (!plan) continue;
    plans.push(plan);
    if (opts.dryRun) continue;

    const apartmentId =
      plan.apartment.kind === 'existing'
        ? plan.apartment.id
        : (await createApartment(plan.apartment.name)).id;

    if (plan.link) await linkTuyaHome(plan.homeId, plan.homeName, apartmentId);
    if (plan.assign.length > 0) await assignUnassignedDevices(plan.assign, apartmentId);
    for (const r of plan.rename) await renameDeviceIfUnchanged(r.id, r.from, r.to);

    if (plan.apartment.kind === 'create') apartments = await listApartments();
    if (plan.link || plan.assign.length > 0 || plan.rename.length > 0) {
      console.log(
        `[tuya-homes] «${plan.homeName}»: ` +
          `${plan.apartment.kind === 'create' ? `створено квартиру «${plan.apartment.name}»` : 'квартира №' + apartmentId}, ` +
          `прив'язано пристроїв: ${plan.assign.length}, перейменовано: ${plan.rename.length}`,
      );
    }
  }

  return plans;
}
