import { useCallback, useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { api, type Device } from '../api';
import { Icon } from './Icon';

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
    </div>
  );
}
