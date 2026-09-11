/** Общие типы и константы рабочего места. */

export const PRESETS = [
  { file: '01_full_constellation', label: '01 · Полная группировка' },
  { file: '02_first_launch', label: '02 · Первая очередь' },
  { file: '03_satellite_outages', label: '03 · Отказ 10 аппаратов' },
  { file: '04_link_range', label: '04 · ISL 2000 км' },
];

/** Откуда взят текущий сценарий — для подписи в списке и кнопки «Сброс». */
export type Source =
  | { kind: 'preset'; file: string }
  | { kind: 'file' | 'variant'; label: string };

export type Tab = 'network' | 'config' | 'compare' | 'resilience';

export type ViewMode = 'globe' | 'map';
