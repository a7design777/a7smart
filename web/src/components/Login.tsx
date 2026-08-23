import { useState, type FormEvent } from 'react';
import { useStore } from '../store';
import { Icon } from './Icon';

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
        <div className="login__mark">
          <Icon name="devices" size={26} />
        </div>
        <h1 className="login__title">a7smart</h1>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Пароль"
          autoComplete="current-password"
          autoFocus
          required
        />
        <button type="submit" className="primary-btn" disabled={busy || password.length === 0}>
          {busy ? 'Вхід…' : 'Увійти'}
        </button>
        {error && <span className="form-error">{error}</span>}
      </form>
    </div>
  );
}
