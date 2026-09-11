/** Форматирование и мелкие утилиты рабочего места. */
export { formatDuration } from '../../core/analysis';

export const pct = (v: number | null | undefined, digits = 1): string =>
  v === null || v === undefined ? '—' : `${(v * 100).toFixed(digits)}%`;

export const num = (v: number | null | undefined, digits = 1): string =>
  v === null || v === undefined ? '—' : v.toFixed(digits);

/** Время от начала расчёта, ЧЧ:ММ. Часы не сворачиваются: горизонт бывает до двух суток. */
export const clock = (s: number): string =>
  Number.isFinite(s)
    ? `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`
    : '—';

/** Чтение файла: Blob.text() есть не во всех окружениях. */
export function readFileText(file: Blob): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export function downloadJson(name: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Firefox отменяет скачивание, если ссылку отозвать сразу.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
