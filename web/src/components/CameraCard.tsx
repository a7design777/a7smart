import { useCallback, useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { api, type Device, type PtzDirection } from '../api';
import { useStore } from '../store';
import { Icon } from './Icon';

/** Компактний 4-напрямковий D-pad. Діагоналі API підтримує, але на телефоні
 *  вісім тісних кнопок незручні — досить основних чотирьох. */
const PTZ_BUTTONS: Array<{ direction: PtzDirection; rotate: number; style: 'up' | 'down' | 'left' | 'right' }> = [
  { direction: 'UP', rotate: 0, style: 'up' },
  { direction: 'LEFT', rotate: -90, style: 'left' },
  { direction: 'RIGHT', rotate: 90, style: 'right' },
  { direction: 'DOWN', rotate: 180, style: 'down' },
];

/**
 * Налаштування камери: сповіщення про рух, нічне бачення, запис, сирена.
 * Згорнуті за замовчуванням — на ТВ і в сітці з 5 камер вони б заважали.
 * Кожен дотик — реальна команда камері, тому вмикаємо лише за кліком.
 */
function CameraSettings({ device }: { device: Device }) {
  const sendCommand = useStore((s) => s.sendCommand);
  const [open, setOpen] = useState(false);
  const serverControls = device.state?.controls ?? [];
  const serverOptions = device.state?.options ?? [];
  // Оптимістичні значення: хмара відповідає з запізненням, і без цього
  // перемикач після дотику здавався б «не реагує».
  const [pending, setPending] = useState<Record<string, string | boolean>>({});
  const controls = serverControls.map((c) => ({ ...c, on: (pending[c.code] as boolean | undefined) ?? c.on }));
  const options = serverOptions.map((o) => ({ ...o, value: (pending[o.code] as string | undefined) ?? o.value }));
  if (controls.length === 0 && options.length === 0) return null;

  const apply = (code: string, value: string | boolean) => {
    setPending((p) => ({ ...p, [code]: value }));
    void sendCommand(device.id, code, value);
    // Якщо камера так і не підтвердила — повертаємо те, що каже сервер.
    setTimeout(() => {
      setPending((p) => {
        const next = { ...p };
        delete next[code];
        return next;
      });
    }, 8000);
  };

  return (
    <div>
      <button type="button" className="ghost-btn" onClick={() => setOpen((v) => !v)}>
        {open ? 'Сховати налаштування' : 'Налаштування камери'}
      </button>

      {open && (
        <div className="camera__settings">
          {options.map((opt) => (
            <div key={opt.code}>
              <span className="card__sub">{opt.label}</span>
              <div className="segmented" role="group" aria-label={opt.label}>
                {opt.choices.map((choice) => (
                  <button
                    key={choice.value}
                    type="button"
                    className="segmented__item"
                    aria-pressed={opt.value === choice.value}
                    onClick={() => apply(opt.code, choice.value)}
                  >
                    {choice.label}
                  </button>
                ))}
              </div>
            </div>
          ))}

          <div className="ov-chips">
            {controls.map((c) => (
              <button
                key={c.code}
                type="button"
                className="segmented__item ov-chip"
                aria-pressed={c.on}
                onClick={() => apply(c.code, !c.on)}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Живий перегляд камери.
 *
 * URL потоку видається Tuya на короткий час, тому запитується лише коли
 * користувач натиснув «Дивитись», і не кешується. Потік грає браузер —
 * транскодингу на сервері немає, інакше 1 vCPU просто ляже.
 *
 * Відтворення запускається явно: атрибут autoplay спрацьовує при
 * початковому завантаженні джерела, а hls.js підключає потік пізніше,
 * після монтування елемента — і відео лишалося б на паузі з готовим
 * першим кадром.
 */
export function CameraCard({ device }: { device: Device }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /** Браузер може відхилити автозапуск — тоді потрібен явний жест. */
  const [needsGesture, setNeedsGesture] = useState(false);
  const [ptzBusy, setPtzBusy] = useState<PtzDirection | null>(null);
  const [ptzError, setPtzError] = useState<string | null>(null);

  async function move(direction: PtzDirection) {
    setPtzBusy(direction);
    setPtzError(null);
    try {
      await api.cameraPtz(device.id, direction);
    } catch (err) {
      // Показуємо причину біля стрілок: тиха відмова виглядала як «кнопка зламана».
      setPtzError(err instanceof Error ? err.message : 'Поворот не вдався');
    } finally {
      setPtzBusy(null);
    }
  }

  const play = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      await video.play();
      setNeedsGesture(false);
    } catch {
      // Не помилка потоку: політика автозапуску вимагає дії користувача.
      setNeedsGesture(true);
    }
  }, []);

  useEffect(() => {
    if (!active) return;

    let hls: Hls | null = null;
    let cancelled = false;

    async function start() {
      setLoading(true);
      setError(null);
      setNeedsGesture(false);
      try {
        const { url } = await api.cameraStream(device.id);
        if (cancelled) return;

        const video = videoRef.current;
        if (!video) return;

        if (Hls.isSupported()) {
          hls = new Hls();
          hls.loadSource(url);
          hls.attachMedia(video);
          hls.on(Hls.Events.MANIFEST_PARSED, () => void play());
          hls.on(Hls.Events.ERROR, (_evt, data) => {
            if (data.fatal) setError(`Потік обірвався (${data.type})`);
          });
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
          // Safari грає HLS нативно, hls.js там не потрібен.
          video.src = url;
          video.addEventListener('loadedmetadata', () => void play(), { once: true });
        } else {
          setError('Браузер не підтримує HLS');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Не вдалося отримати потік');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void start();

    return () => {
      cancelled = true;
      hls?.destroy();
    };
  }, [active, device.id, play]);

  return (
    <div className="card camera">
      <div className="row">
        <span className="card__icon">
          <Icon name="camera" size={16} />
        </span>
        <span className="card__name" title={device.name} style={{ flex: 1 }}>
          {device.name}
        </span>
        <button type="button" className="ghost-btn" onClick={() => setActive((v) => !v)}>
          {active ? 'Зупинити' : 'Дивитись'}
        </button>
      </div>

      <div className="camera__frame">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          controls
          style={{ display: active ? 'block' : 'none' }}
        />

        {!active && <div className="camera__placeholder">Потік вимкнено</div>}

        {active && needsGesture && (
          <button
            type="button"
            className="camera__play"
            onClick={() => void play()}
            aria-label="Відтворити"
          >
            <Icon name="play" size={22} />
          </button>
        )}
      </div>

      {loading && <span className="card__sub">під'єднання…</span>}
      {error && <span className="card__sub">{error}</span>}

      <CameraSettings device={device} />

      {ptzError && <span className="card__sub">Поворот: {ptzError}</span>}

      {active && device.state?.ptz && (
        <div className="camera__ptz" role="group" aria-label="Керування поворотом камери">
          {PTZ_BUTTONS.map(({ direction, rotate, style }) => (
            <button
              key={direction}
              type="button"
              className={`camera__ptz-btn camera__ptz-btn--${style}`}
              disabled={ptzBusy !== null}
              onClick={() => void move(direction)}
              aria-label={`Повернути камеру: ${direction}`}
            >
              <Icon name="chevron-up" size={18} style={{ transform: `rotate(${rotate}deg)` }} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
