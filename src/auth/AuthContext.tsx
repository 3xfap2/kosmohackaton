/**
 * Профиль проектировщика.
 *
 * ВАЖНО: хранилище локальное — учётные записи и сохранённые варианты лежат в
 * localStorage браузера и никуда не передаются. Сервера у решения нет, поэтому
 * это не средство защиты доступа, а способ разделять рабочие наборы вариантов
 * на одном рабочем месте. Расчётная часть сервиса доступна без входа.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

export interface Profile {
  id: string;
  name: string;
  email: string;
}

interface StoredAccount extends Profile {
  passwordHash: string;
}

interface AuthValue {
  profile: Profile | null;
  register(name: string, email: string, password: string): Promise<void>;
  login(email: string, password: string): Promise<void>;
  logout(): void;
}

const ACCOUNTS_KEY = 'cosmo.accounts';
const SESSION_KEY = 'cosmo.session';

const AuthContext = createContext<AuthValue | null>(null);

function readAccounts(): StoredAccount[] {
  try {
    return JSON.parse(localStorage.getItem(ACCOUNTS_KEY) ?? '[]') as StoredAccount[];
  } catch {
    return [];
  }
}

function writeAccounts(list: StoredAccount[]): void {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(list));
}

async function hash(password: string): Promise<string> {
  const bytes = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const normalize = (email: string): string => email.trim().toLowerCase();

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    try {
      const id = localStorage.getItem(SESSION_KEY);
      if (!id) return;
      const account = readAccounts().find((a) => a.id === id);
      if (account) setProfile({ id: account.id, name: account.name, email: account.email });
    } catch {
      /* приватный режим браузера — работаем без сохранённой сессии */
    }
  }, []);

  const register = useCallback(async (name: string, email: string, password: string) => {
    const clean = normalize(email);
    if (name.trim().length < 2) throw new Error('Укажите имя — минимум два символа.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) throw new Error('Проверьте адрес почты.');
    if (password.length < 6) throw new Error('Пароль должен быть не короче шести символов.');

    const accounts = readAccounts();
    if (accounts.some((a) => normalize(a.email) === clean)) {
      throw new Error('Профиль с такой почтой уже создан на этом устройстве.');
    }
    const account: StoredAccount = {
      id: crypto.randomUUID(),
      name: name.trim(),
      email: clean,
      passwordHash: await hash(password),
    };
    writeAccounts([...accounts, account]);
    localStorage.setItem(SESSION_KEY, account.id);
    setProfile({ id: account.id, name: account.name, email: account.email });
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const clean = normalize(email);
    const account = readAccounts().find((a) => normalize(a.email) === clean);
    if (!account || account.passwordHash !== (await hash(password))) {
      throw new Error('Не нашли такой профиль на этом устройстве. Проверьте почту и пароль.');
    }
    localStorage.setItem(SESSION_KEY, account.id);
    setProfile({ id: account.id, name: account.name, email: account.email });
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(SESSION_KEY);
    setProfile(null);
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ profile, register, login, logout }),
    [profile, register, login, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth вызван вне AuthProvider');
  return ctx;
}
