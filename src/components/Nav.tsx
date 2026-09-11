import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

export default function Nav() {
  const { profile, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <nav className="nav">
      <NavLink to="/" className="brand">
        <span className="brand-mark" />
        <span className="mono">
          <span className="brand-name">Орбита</span>
        </span>
      </NavLink>

      <div className="nav-links">
        <NavLink to="/" end>
          Обзор
        </NavLink>
        <NavLink to="/app">Рабочее место</NavLink>
        <NavLink to="/method">Методика</NavLink>
      </div>

      <div className="spacer" />

      {profile ? (
        <div className="nav-user">
          <span className="avatar" title={profile.email}>
            {initials(profile.name)}
          </span>
          <button className="btn btn-bare btn-sm" onClick={logout}>
            Выйти
          </button>
        </div>
      ) : (
        <div className="nav-user">
          <button className="btn btn-bare btn-sm" onClick={() => navigate('/auth')}>
            Войти
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => navigate('/app')}>
            Открыть сервис
          </button>
        </div>
      )}
    </nav>
  );
}
