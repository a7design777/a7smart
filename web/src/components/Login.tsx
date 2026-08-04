import { useState, type FormEvent } from 'react';
import { useStore } from '../store';

export function Login() {
  const login = useStore((s) => s.login);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(password);
    } catch {
      setError('Невірний пароль');
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form onSubmit={(e) => void onSubmit(e)}>
        <h1 style={{ fontSize: 20, margin: '0 0 4px' }}>a7smart</h1>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Пароль"
          autoComplete="current-password"
          autoFocus
          required
        />
        <button type="submit" disabled={busy || password.length === 0}>
          {busy ? 'Вхід…' : 'Увійти'}
        </button>
        {error && <span style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</span>}
      </form>
    </div>
  );
}
