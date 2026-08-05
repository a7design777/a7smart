import { config } from '../config.js';

/**
 * Клієнт Remihome (Remica).
 *
 * Публічного API виробник не документує. Це той самий інтерфейс, яким
 * користується їхній веб-портал віддаленого доступу: логін формою →
 * сесійна cookie → JSON-ендпоїнти вигляду
 *   /{installation}/RemicaHome/devices?includeHidden=false
 *
 * Наслідок, який треба тримати в голові: інтерфейс недокументований і
 * може змінитися без попередження. Тому Remihome тут — доповнення до
 * Tuya, а не заміна: його відмова не має валити дашборд.
 */

const BASE = 'https://proxy.remihome.es';

export class RemihomeError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'RemihomeError';
  }
}

/** Чи налаштований Remihome. Без цього провайдер просто не вмикається. */
export function isRemihomeConfigured(): boolean {
  return Boolean(
    config.REMIHOME_EMAIL && config.REMIHOME_PASSWORD && config.REMIHOME_INSTALLATION,
  );
}

let sessionCookie: string | null = null;
let inflightLogin: Promise<string> | null = null;

/** Витягує пари name=value з усіх Set-Cookie відповіді. */
function collectCookies(res: Response): string | null {
  const raw = res.headers.getSetCookie?.() ?? [];
  const pairs = raw.map((c) => c.split(';')[0]).filter(Boolean);
  return pairs.length > 0 ? pairs.join('; ') : null;
}

async function login(): Promise<string> {
  const body = new URLSearchParams({
    username: config.REMIHOME_EMAIL!,
    password: config.REMIHOME_PASSWORD!,
    login: 'Accede',
  });

  // Портал спершу видає cookie на GET, і саме її очікує при POST.
  const seed = await fetch(`${BASE}/proxy/login`, { redirect: 'manual' });
  const seedCookie = collectCookies(seed);

  const res = await fetch(`${BASE}/proxy/login`, {
    method: 'POST',
    body,
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(seedCookie ? { Cookie: seedCookie } : {}),
    },
  });

  const cookie = collectCookies(res) ?? seedCookie;
  if (!cookie) {
    throw new RemihomeError('Логін не повернув сесійної cookie', res.status);
  }

  // Портал відповідає редиректом і на успіх, і на невдачу, тож
  // перевіряємо не статус, а те, чи веде редирект назад на логін.
  const location = res.headers.get('location') ?? '';
  if (location.includes('/proxy/login')) {
    throw new RemihomeError('Невірний email або пароль Remihome', res.status);
  }

  sessionCookie = cookie;
  return cookie;
}

async function getSession(): Promise<string> {
  if (sessionCookie) return sessionCookie;
  if (inflightLogin) return inflightLogin;

  inflightLogin = login().finally(() => {
    inflightLogin = null;
  });
  return inflightLogin;
}

/**
 * GET до API інсталяції. Шлях указується без префікса
 * `/{installation}/RemicaHome`.
 *
 * При 401/302 сесія скидається й запит повторюється один раз — сесійні
 * cookie порталу живуть недовго.
 */
export async function remihomeGet<T>(path: string, retry = true): Promise<T> {
  return remihomeRequest<T>(path, 'GET', retry);
}

export async function remihomeRequest<T>(
  path: string,
  method: 'GET' | 'POST' | 'PUT' = 'GET',
  retry = true,
  body?: unknown,
): Promise<T> {
  const cookie = await getSession();
  const url = `${BASE}/${config.REMIHOME_INSTALLATION}/RemicaHome${path}`;
  const payload = body === undefined ? undefined : JSON.stringify(body);

  const res = await fetch(url, {
    method,
    headers: {
      Cookie: cookie,
      Accept: 'application/json, text/javascript, */*; q=0.01',
      // Портал відповідає JSON лише на запити, які виглядають як AJAX
      // від його власного інтерфейсу.
      'X-Requested-With': 'XMLHttpRequest',
      Referer: `${BASE}/${config.REMIHOME_INSTALLATION}/RemicaHome`,
      ...(payload ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(payload ? { body: payload } : {}),
    redirect: 'manual',
  });

  // Редирект тут означає «сесія протухла»: API віддає JSON, а не сторінки.
  if (res.status === 401 || res.status === 403 || (res.status >= 300 && res.status < 400)) {
    sessionCookie = null;
    if (retry) return remihomeRequest<T>(path, method, false, body);
    throw new RemihomeError(`Сесію відхилено: ${url}`, res.status);
  }

  if (!res.ok) {
    // Код статусу та початок тіла — єдине, що дозволяє відрізнити
    // «немає такого шляху» від «потрібен інший метод» чи «немає прав».
    const body = await res.text().catch(() => '');
    throw new RemihomeError(
      `HTTP ${res.status} ${res.statusText} → ${url}${body ? `\n    тіло: ${body.slice(0, 160)}` : ''}`,
      res.status,
    );
  }

  const text = await res.text();
  // Керуючі запити можуть відповідати порожнім тілом — це успіх.
  if (text.trim() === '') return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    // Отримали HTML замість JSON — майже завжди це сторінка логіну.
    throw new RemihomeError(
      `Очікувався JSON, отримано ${text.slice(0, 60)}…`,
      res.status,
    );
  }
}
