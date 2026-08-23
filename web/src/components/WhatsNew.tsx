import { useEffect, useState } from 'react';
import { CHANGELOG } from '../changelog';
import { api } from '../api';
import { Icon } from './Icon';

const SEEN_KEY = 'a7smart-changelog-seen';

/** Непрочитана крапка — поки версія найновішого запису не збігається зі збереженою. */
export function useUnseenChangelog(): boolean {
  const [unseen, setUnseen] = useState(false);

  useEffect(() => {
    const latest = CHANGELOG[0]?.version;
    if (latest && localStorage.getItem(SEEN_KEY) !== latest) {
      setUnseen(true);
    }
  }, []);

  return unseen;
}

function markSeen() {
  const latest = CHANGELOG[0]?.version;
  if (latest) localStorage.setItem(SEEN_KEY, latest);
}

/** Лист знизу зі списком змін — той самий патерн «Що нового», що й в App Store. */
export function WhatsNew({ onClose }: { onClose: () => void }) {
  const [buildVersion, setBuildVersion] = useState<string | null>(null);

  useEffect(() => {
    markSeen();
    api
      .health()
      .then((h) => setBuildVersion(h.version.slice(0, 7)))
      .catch(() => undefined);
  }, []);

  return (
    <>
      <div className="sheet-scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Що нового">
        <div className="sheet__grip" />
        <div className="sheet__head">
          <span className="sheet__title">Що нового</span>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Закрити"
          >
            <Icon name="close" size={20} />
          </button>
        </div>
        <div className="sheet__body">
          {CHANGELOG.map((entry) => (
            <div className="changelog-entry" key={entry.version}>
              <div className="changelog-entry__head">
                <span className="changelog-entry__version">Версія {entry.version}</span>
                <span className="changelog-entry__date">{entry.date}</span>
              </div>
              <ul>
                {entry.items.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
          {buildVersion && (
            <p className="card__sub" style={{ marginTop: 4 }}>
              Поточна збірка: {buildVersion}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
