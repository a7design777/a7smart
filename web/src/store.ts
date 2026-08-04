import { create } from 'zustand';
import { api, UnauthorizedError, type Apartment, type Device } from './api';

/**
 * Стани оновлюються поллінгом раз на 15 с. Сервер віддає їх із кешу,
 * тому це дешево — у Tuya ходить лише фоновий поллер бекенду.
 */
const REFRESH_MS = 15_000;

interface AppState {
  authed: boolean;
  loading: boolean;
  error: string | null;
  apartments: Apartment[];
  devices: Device[];
  activeApartmentId: number | null;

  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  setApartment: (id: number | null) => void;
  sendCommand: (deviceId: string, code: string, value: unknown) => Promise<void>;
}

let refreshTimer: ReturnType<typeof setInterval> | null = null;

export const useStore = create<AppState>((set, get) => ({
  authed: false,
  loading: true,
  error: null,
  apartments: [],
  devices: [],
  activeApartmentId: null,

  async login(password) {
    await api.login(password);
    set({ authed: true, error: null });
    await get().refresh();
  },

  async logout() {
    await api.logout();
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = null;
    set({ authed: false, devices: [], apartments: [] });
  },

  async refresh() {
    try {
      const [apartments, devices] = await Promise.all([api.apartments(), api.devices()]);
      set((s) => ({
        apartments,
        devices,
        authed: true,
        loading: false,
        error: null,
        activeApartmentId: s.activeApartmentId ?? apartments[0]?.id ?? null,
      }));

      if (!refreshTimer) {
        refreshTimer = setInterval(() => {
          void get().refresh();
        }, REFRESH_MS);
      }
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        if (refreshTimer) clearInterval(refreshTimer);
        refreshTimer = null;
        set({ authed: false, loading: false });
        return;
      }
      set({ error: err instanceof Error ? err.message : String(err), loading: false });
    }
  },

  setApartment(id) {
    set({ activeApartmentId: id });
  },

  async sendCommand(deviceId, code, value) {
    // Оптимістичне оновлення: Tuya відповідає 0.5–2 с, і без цього
    // перемикач у UI виглядав би зламаним.
    set((s) => ({
      devices: s.devices.map((d) =>
        d.id === deviceId && d.state
          ? {
              ...d,
              state: {
                ...d.state,
                gangs: d.state.gangs.map((g) =>
                  g.code === code ? { ...g, on: Boolean(value) } : g,
                ),
              },
            }
          : d,
      ),
    }));

    try {
      await api.command(deviceId, code, value);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      // Відкат до правди з сервера.
      await get().refresh();
      return;
    }

    // Даємо Tuya час застосувати команду, потім звіряємось.
    setTimeout(() => void get().refresh(), 2000);
  },
}));
