import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export default function Auth() {
  const { register, login } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'register') await register(name, email, password);
      else await login(email, password);
      navigate('/app');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не получилось. Попробуйте ещё раз.');
    } finally {
      setBusy(false);
    }
  };

  const switchTo = (next: 'login' | 'register') => {
    setMode(next);
    setError('');
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="mono">— Профиль проектировщика</div>
        <h2>{mode === 'register' ? 'Создать профиль' : 'Войти в профиль'}</h2>
        <p className="sub">
          {mode === 'register'
            ? 'Нужен, чтобы ваши сохранённые варианты не смешивались с чужими.'
            : 'Войдите, чтобы вернуться к сохранённым вариантам.'}
        </p>

        <form onSubmit={submit}>
          {error && <div className="form-error">{error}</div>}

          {mode === 'register' && (
            <label>
              <span>Имя</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Иван Петров"
                autoComplete="name"
              />
            </label>
          )}

          <label>
            <span>Почта</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="engineer@example.ru"
              autoComplete="email"
            />
          </label>

          <label>
            <span>Пароль</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Минимум шесть символов"
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            />
          </label>

          <button className="btn btn-primary" style={{ width: '100%', marginTop: 8 }} disabled={busy}>
            {busy ? 'Секунду…' : mode === 'register' ? 'Создать профиль' : 'Войти'}
          </button>
        </form>

        <div className="auth-switch">
          {mode === 'register' ? (
            <>
              Уже создавали профиль? <button onClick={() => switchTo('login')}>Войти</button>
            </>
          ) : (
            <>
              Ещё нет профиля? <button onClick={() => switchTo('register')}>Создать</button>
            </>
          )}
        </div>

        <div className="notice">
          Профиль хранится только в этом браузере: сервера у решения нет, данные никуда не
          передаются. Расчётная часть полностью доступна без входа —{' '}
          <Link to="/app">откройте рабочее место</Link> напрямую.
        </div>
      </div>
    </div>
  );
}
