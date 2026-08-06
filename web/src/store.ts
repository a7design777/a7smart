import { create } from 'zustand';
import {
  api,
  UnauthorizedError,
  type Apartment,
  type Device,
  type Gang,
  type Scene,
  type SceneInput,
} from './api';

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
  toggleGang: (deviceId: string, gang: Gang) => Promise<void>;
  addApartment: (name: string) => Promise<void>;
  removeApartment: (id: number) => Promise<void>;
  setMain: (id: number) => Promise<void>;
  assign: (deviceId: string, apartmentId: number | null) => Promise<void>;
  setOrder: (ids: string[]) => void;
  commitOrder: () => Promise<void>;
  rename: (deviceId: string, name: string) => Promise<void>;

  scenes: Scene[];
  loadScenes: () => Promise<void>;
  saveScene: (id: number | null, scene: SceneInput) => Promise<void>;
  removeScene: (id: number) => Promise<void>;
  runScene: (id: number) => Promise<void>;
}

/** Вибір квартири робиться один раз за сесію — далі не перебиваємо користувача. */
let apartmentChosen = false;

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

      set((s) => {
        // При першому завантаженні відкриваємо головну квартиру.
        // Далі вибір користувача не чіпаємо — інакше кожні 15 секунд
        // дашборд перекидало б назад на головну.
        let active = s.activeApartmentId;
        if (!apartmentChosen && apartments.length > 0) {
          active = apartments.find((a) => a.is_main)?.id ?? null;
          apartmentChosen = true;
        }

        return {
          apartments,
          devices,
          authed: true,
          loading: false,
          error: null,
          // Якщо обрана квартира зникла (видалили тут або в іншій вкладці),
          // повертаємось до «Усі»: вкладки, щоб перемкнутися назад, уже немає.
          activeApartmentId: apartments.some((a) => a.id === active) ? active : null,
        };
      });

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
    try {
      await api.command(deviceId, code, value);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      await get().refresh();
      return;
    }

    // Сервер уже дочекався застосування й перечитав стан перед відповіддю,
    // тому тут достатньо короткої паузи.
    setTimeout(() => void get().refresh(), 400);
  },

  /**
   * Перемикання живлення винесене окремо, бо тут потрібні дві різні речі:
   * булеве значення для UI і вендорське — для запиту. Раніше вони були
   * одним значенням, і для Remihome в запит ішло "true" замість "on".
   */
  async toggleGang(deviceId, gang) {
    const next = !gang.on;

    // Оптимістичне оновлення: хмара відповідає 0.5–2 с, без цього
    // перемикач виглядав би зламаним.
    set((s) => ({
      devices: s.devices.map((d) =>
        d.id === deviceId && d.state
          ? {
              ...d,
              state: {
                ...d.state,
                gangs: d.state.gangs.map((g) =>
                  g.code === gang.code ? { ...g, on: next } : g,
                ),
              },
            }
          : d,
      ),
    }));

    await get().sendCommand(deviceId, gang.code, next ? gang.onValue : gang.offValue);
  },

  async addApartment(name) {
    const apartment = await api.createApartment(name);
    set((s) => ({ apartments: [...s.apartments, apartment] }));
  },

  async removeApartment(id) {
    await api.deleteApartment(id);
    set((s) => ({
      apartments: s.apartments.filter((a) => a.id !== id),
      // Пристрої не зникають разом із квартирою — вони повертаються
      // в «Без квартири» (на боці БД це ON DELETE SET NULL).
      devices: s.devices.map((d) =>
        d.apartmentId === id ? { ...d, apartmentId: null } : d,
      ),
      activeApartmentId: s.activeApartmentId === id ? null : s.activeApartmentId,
    }));
  },

  async setMain(id) {
    set((s) => ({
      apartments: s.apartments.map((a) => ({ ...a, is_main: a.id === id })),
    }));
    try {
      await api.setMainApartment(id);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      await get().refresh();
    }
  },

  async assign(deviceId, apartmentId) {
    // Оптимістично: перетягування має відгукуватися миттєво.
    set((s) => ({
      devices: s.devices.map((d) => (d.id === deviceId ? { ...d, apartmentId } : d)),
    }));
    try {
      await api.assignDevice(deviceId, apartmentId);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      await get().refresh();
    }
  },

  /**
   * Локальна перестановка під час перетягування — без запиту на сервер.
   *
   * Переставляються лише видимі пристрої, і саме в тих позиціях, які вони
   * займали в повному списку. Інакше перетягування в одній квартирі
   * перемішувало б порядок в усіх інших: `sort_order` спільний на всі
   * пристрої, а не окремий для кожної квартири.
   */
  setOrder(ids) {
    set((s) => {
      const byId = new Map(s.devices.map((d) => [d.id, d]));
      const moving = ids.map((id) => byId.get(id)).filter((d): d is Device => Boolean(d));
      const slots = new Set(ids);

      let next = 0;
      const devices = s.devices.map((d) => (slots.has(d.id) ? moving[next++]! : d));
      return { devices };
    });
  },

  /** Зберігається повний порядок — щоб позиції інших квартир не зсувались. */
  async commitOrder() {
    try {
      await api.reorderDevices(get().devices.map((d) => d.id));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      await get().refresh();
    }
  },

  async rename(deviceId, name) {
    set((s) => ({
      devices: s.devices.map((d) => (d.id === deviceId ? { ...d, name } : d)),
    }));
    try {
      await api.renameDevice(deviceId, name);
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
      await get().refresh();
    }
  },

  scenes: [],

  async loadScenes() {
    try {
      set({ scenes: await api.scenes() });
    } catch (err) {
      if (!(err instanceof UnauthorizedError)) {
        set({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  },

  async saveScene(id, scene) {
    if (id === null) {
      await api.createScene(scene);
    } else {
      await api.updateScene(id, scene);
    }
    await get().loadScenes();
  },

  async removeScene(id) {
    await api.deleteScene(id);
    set((s) => ({ scenes: s.scenes.filter((x) => x.id !== id) }));
  },

  async runScene(id) {
    try {
      const res = await api.runScene(id);
      if (!res.ok) {
        const failed = res.results.filter((r) => !r.ok);
        set({
          error: `Сценарій виконано частково: не вдалося ${failed.length} з ${res.results.length} дій`,
        });
      } else {
        set({ error: null });
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
    await get().refresh();
  },
}));
