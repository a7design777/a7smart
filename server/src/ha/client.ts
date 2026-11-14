import { config } from '../config.js';

/**
 * Клієнт Home Assistant (REST API) — лише читання.
 *
 * Авторизація — long-lived access token. Токен краще створити окремим
 * користувачем HA з мінімальними правами. Жодних викликів /api/services
 * тут немає навмисно: керування через HA вмикається окремим кроком.
 *
 * HA живе в локальній мережі, а сервер a7smart — на VPS, тому HA_URL
 * зазвичай указує на Cloudflare Tunnel. Якщо тунель закрито Cloudflare
 * Access, додаються service-token заголовки.
 */

export class HaError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'HaError';
  }
}

export function isHaConfigured(): boolean {
  return Boolean(config.HA_URL && config.HA_TOKEN);
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${config.HA_TOKEN}`,
    'Content-Type': 'application/json',
    ...(config.HA_CF_ACCESS_CLIENT_ID && config.HA_CF_ACCESS_CLIENT_SECRET
      ? {
          'CF-Access-Client-Id': config.HA_CF_ACCESS_CLIENT_ID,
          'CF-Access-Client-Secret': config.HA_CF_ACCESS_CLIENT_SECRET,
        }
      : {}),
  };
}

async function request(path: string, init: RequestInit): Promise<string> {
  const base = config.HA_URL!.replace(/\/+$/, '');
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      headers: headers(),
      // HA у тунелі може «зависати» — не тримаємо цикл поллера вічно.
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new HaError(`HA недосяжний: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (res.status === 401) {
    throw new HaError('HA відхилив токен (401): перевірте HA_TOKEN', 401);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new HaError(`HTTP ${res.status} → ${path}${body ? `: ${body.slice(0, 160)}` : ''}`, res.status);
  }
  return res.text();
}

export interface HaState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed?: string;
}

/** Усі стани за один запит — локальний і дешевий, квоти немає. */
export async function haGetStates(): Promise<HaState[]> {
  const text = await request('/api/states', { method: 'GET' });
  try {
    return JSON.parse(text) as HaState[];
  } catch {
    throw new HaError(`Очікувався JSON зі станами, отримано ${text.slice(0, 60)}…`);
  }
}

/**
 * Прогноз погоди. У сучасному HA він не лежить в атрибутах сутності — його
 * віддає лише сервіс `weather.get_forecasts`. Це ЄДИНИЙ виклик сервісу, який
 * ми робимо: він лише читає (`return_response`), шлях і сервіс прописані
 * жорстко, довільних викликів /api/services тут немає навмисно.
 */
export async function haGetDailyForecast(entityId: string): Promise<unknown[]> {
  const text = await request('/api/services/weather/get_forecasts?return_response', {
    method: 'POST',
    body: JSON.stringify({ entity_id: entityId, type: 'daily' }),
  });
  const data = JSON.parse(text) as {
    service_response?: Record<string, { forecast?: unknown[] }>;
  };
  return data.service_response?.[entityId]?.forecast ?? [];
}

/** Рендер Jinja-шаблону на стороні HA. Потрібен, щоб дізнатися device_id. */
export async function haTemplate(template: string): Promise<string> {
  return request('/api/template', { method: 'POST', body: JSON.stringify({ template }) });
}
