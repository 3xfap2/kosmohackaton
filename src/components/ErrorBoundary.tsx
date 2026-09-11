/**
 * Изоляция сбоя в одной части интерфейса.
 *
 * Без неё исключение в любом компоненте размонтирует всё приложение — эксперт
 * увидит пустой экран. Особенно важно для глобуса: WebGL может быть недоступен
 * в браузере проверяющего, и тогда страница должна остаться рабочей.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  fallback: ReactNode;
  children: ReactNode;
  /** Сообщить родителю о сбое — например, чтобы переключить вид. */
  onError?: (error: Error) => void;
}

interface State {
  failed: boolean;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Сбой компонента, показан запасной вариант:', error, info.componentStack);
    this.props.onError?.(error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
