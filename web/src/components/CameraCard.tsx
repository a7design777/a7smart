import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { api, type Device } from '../api';

/**
 * Живий перегляд камери.
 *
 * URL потоку видається Tuya на короткий час, тому запитується лише коли
 * користувач натиснув «Дивитись», і не кешується. Потік грає браузер —
 * транскодингу на сервері немає, інакше 1 vCPU просто ляже.
 */
export function CameraCard({ device }: { device: Device }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!active) return;

    let hls: Hls | null = null;
    let cancelled = false;

    async function start() {
      setLoading(true);
      setError(null);
      try {
        const { url } = await api.cameraStream(device.id);
        if (cancelled) return;

        const video = videoRef.current;
        if (!video) return;

        if (Hls.isSupported()) {
          hls = new Hls({ lowLatencyMode: true });
          hls.loadSource(url);
          hls.attachMedia(video);
          hls.on(Hls.Events.ERROR, (_evt, data) => {
            if (data.fatal) setError('Потік обірвався');
          });
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
          // Safari грає HLS нативно, hls.js там не потрібен.
          video.src = url;
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
  }, [active, device.id]);

  return (
    <div className="card camera">
      <div className="row">
        <span className="card__name" title={device.name}>
          {device.name}
        </span>
        <button type="button" className="ghost-btn" onClick={() => setActive((v) => !v)}>
          {active ? 'Зупинити' : 'Дивитись'}
        </button>
      </div>

      {active ? (
        <>
          <video ref={videoRef} autoPlay muted playsInline controls />
          {loading && <span className="card__sub">під'єднання…</span>}
          {error && <span className="card__sub">{error}</span>}
        </>
      ) : (
        <div className="camera__placeholder">Потік вимкнено</div>
      )}
    </div>
  );
}
