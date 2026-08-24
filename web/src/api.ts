export interface Metric {
  code: string;
  key: string;
  value: number;
  unit: string;
}

/** Стан-перелік: відкрито/закрито, протікання, рух. */
export interface StateFlag {
  code: string;
  key: string;
  label: string;
  /** true — потрібна увага (протікання, газ, сіла батарея). */
  alarm: boolean;
}

/**
 * Канал керування живленням.
 *
 * `onValue`/`offValue` — те, що очікує конкретний вендор: Tuya приймає
 * булеве, Remihome — рядки "on"/"off".
 */
export interface Gang {
  code: string;
  label: string;
  on: boolean;
  onValue: boolean | string;
  offValue: boolean | string;
}

/** Керування з переліком варіантів — швидкість фанкойла, режим термостата. */
export interface OptionControl {
  code: string;
  label: string;
  value: string;
  choices: Array<{ value: string; label: string }>;
}

export interface DeviceState {
  id: string;
  name: string;
  kind: 'switch' | 'light' | 'climate' | 'sensor' | 'camera' | 'unknown';
  online: boolean;
  gangs: Gang[];
  target: { code: string; value: number; min: number; max: number } | null;
  metrics: Metric[];
  states: StateFlag[];
  options: OptionControl[];
}

export interface Device {
  id: string;
  name: string;
  kind: DeviceState['kind'];
  apartmentId: number | null;
  state: DeviceState | null;
}

export interface Apartment {
  id: number;
  slug: string;
  name: string;
  sort_order: number;
  /** Головна квартира — відкривається одразу при вході. */
  is_main: boolean;
}

export interface HistoryPoint {
  bucket: string;
  avg: number;
  min: number;
  max: number;
}

/** Кидається при 401 — застосунок реагує показом екрана входу. */
export class UnauthorizedError extends Error {
  constructor() {
    super('unauthorized');
    this.name = 'UnauthorizedError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });

  if (res.status === 401) throw new UnauthorizedError();

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `Запит не вдався: ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export const api = {
  login: (password: string) =>
    request<{ ok: true }>('/login', { method: 'POST', body: JSON.stringify({ password }) }),

  logout: () => request<{ ok: true }>('/logout', { method: 'POST' }),

  apartments: () => request<Apartment[]>('/apartments'),

  devices: () => request<Device[]>('/devices'),

  command: (deviceId: string, code: string, value: unknown) =>
    request<{ ok: true }>(`/devices/${deviceId}/command`, {
      method: 'POST',
      body: JSON.stringify({ code, value }),
    }),

  cameraStream: (deviceId: string) =>
    request<{ url: string; expire: number | null }>(`/cameras/${deviceId}/stream`),

  history: (deviceId: string, key: string, range: { hours: number } | { from: string; to: string }) => {
    const period =
      'hours' in range
        ? `hours=${range.hours}`
        : `from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;
    return request<HistoryPoint[]>(
      `/history?device=${encodeURIComponent(deviceId)}&key=${encodeURIComponent(key)}&${period}`,
    );
  },

  sync: () => request<{ count: number }>('/sync', { method: 'POST' }),

  createApartment: (name: string) =>
    request<Apartment>('/apartments', { method: 'POST', body: JSON.stringify({ name }) }),

  renameApartment: (id: number, name: string) =>
    request<{ ok: true }>(`/apartments/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),

  deleteApartment: (id: number) =>
    request<{ ok: true }>(`/apartments/${id}`, { method: 'DELETE' }),

  setMainApartment: (id: number) =>
    request<{ ok: true }>(`/apartments/${id}/main`, { method: 'PATCH' }),

  assignDevice: (deviceId: string, apartmentId: number | null) =>
    request<{ ok: true }>(`/devices/${deviceId}/apartment`, {
      method: 'PATCH',
      body: JSON.stringify({ apartmentId }),
    }),

  renameDevice: (deviceId: string, name: string) =>
    request<{ ok: true }>(`/devices/${deviceId}/name`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),

  energy: (days: number) => request<EnergyBucket[]>(`/energy?days=${days}`),

  energyTop: (days: number, apartmentId: number | null) =>
    request<TopConsumer[]>(
      `/energy/top?days=${days}${apartmentId !== null ? `&apartmentId=${apartmentId}` : ''}`,
    ),

  health: () => request<HealthInfo>('/health'),

  reorderDevices: (ids: string[]) =>
    request<{ ok: true }>('/devices/order', {
      method: 'PATCH',
      body: JSON.stringify({ ids }),
    }),

  scenes: () => request<Scene[]>('/scenes'),

  createScene: (scene: SceneInput) =>
    request<{ id: number }>('/scenes', { method: 'POST', body: JSON.stringify(scene) }),

  updateScene: (id: number, scene: SceneInput) =>
    request<{ ok: true }>(`/scenes/${id}`, { method: 'PUT', body: JSON.stringify(scene) }),

  deleteScene: (id: number) => request<{ ok: true }>(`/scenes/${id}`, { method: 'DELETE' }),

  runScene: (id: number) =>
    request<{ ok: boolean; results: SceneRunResult[] }>(`/scenes/${id}/run`, {
      method: 'POST',
    }),
};

export interface SceneAction {
  device_id: string;
  code: string;
  value: string;
  /** Потрібен, щоб відновити форму значення: Tuya приймає булеве, Remihome — рядки. */
  value_type: 'string' | 'boolean' | 'number';
}

export interface Scene {
  id: number;
  name: string;
  apartment_id: number | null;
  icon: string | null;
  sort_order: number;
  actions: SceneAction[];
}

export interface SceneInput {
  name: string;
  apartmentId: number | null;
  actions: SceneAction[];
}

export interface SceneRunResult {
  deviceId: string;
  code: string;
  ok: boolean;
  error?: string;
}

export interface EnergyBucket {
  apartment_id: number | null;
  bucket: string;
  kwh: number;
}

export interface TopConsumer {
  device_id: string;
  name: string;
  kwh: number;
}

export interface HealthInfo {
  version: string;
  ok: boolean;
  lastPollAt: string | null;
  lastError: string | null;
}
