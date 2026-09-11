/**
 * Сохранённые варианты проекта.
 *
 * Хранятся локально и раздельно по профилям; без входа используется набор
 * «гость». Вариант сохраняет сценарий целиком, поэтому к нему можно вернуться
 * и пересчитать на той же сетке времени — этого требует сравнение по ТЗ.
 */
import type { ClientMetrics } from './simulate';
import type { Scenario } from './types';

export interface Variant {
  id: string;
  name: string;
  created_at: string;
  scenario: Scenario;
  /** Снимок показателей на момент сохранения — для быстрой таблицы сравнения. */
  metrics: ClientMetrics[];
}

const key = (owner: string | null): string => `cosmo.variants.${owner ?? 'guest'}`;

export function listVariants(owner: string | null): Variant[] {
  try {
    return JSON.parse(localStorage.getItem(key(owner)) ?? '[]') as Variant[];
  } catch {
    return [];
  }
}

export function saveVariant(
  owner: string | null,
  name: string,
  scenario: Scenario,
  metrics: ClientMetrics[],
): Variant[] {
  const variant: Variant = {
    id: crypto.randomUUID(),
    name: name.trim() || `Вариант ${new Date().toLocaleTimeString('ru-RU')}`,
    created_at: new Date().toISOString(),
    scenario: structuredClone(scenario),
    metrics: structuredClone(metrics),
  };
  const next = [...listVariants(owner), variant];
  localStorage.setItem(key(owner), JSON.stringify(next));
  return next;
}

export function removeVariant(owner: string | null, id: string): Variant[] {
  const next = listVariants(owner).filter((v) => v.id !== id);
  localStorage.setItem(key(owner), JSON.stringify(next));
  return next;
}

/** Изменения конфигурации между двумя вариантами — колонка «что поменяли». */
export function diffScenarios(a: Scenario, b: Scenario): string[] {
  const out: string[] = [];
  if (a.design.launch_stage !== b.design.launch_stage) {
    out.push(`очередь запуска ${a.design.launch_stage} → ${b.design.launch_stage}`);
  }
  for (const pa of a.design.planes) {
    const pb = b.design.planes.find((p) => p.id === pa.id);
    if (!pb) continue;
    if (pa.raan_deg !== pb.raan_deg) out.push(`${pa.id} RAAN ${pa.raan_deg}° → ${pb.raan_deg}°`);
    if (pa.phase_deg !== pb.phase_deg) {
      out.push(`${pa.id} фаза ${pa.phase_deg}° → ${pb.phase_deg}°`);
    }
  }
  if (a.failures.length !== b.failures.length) {
    out.push(`периодов отказа ${a.failures.length} → ${b.failures.length}`);
  }
  if (a.environment.isl_range_km !== b.environment.isl_range_km) {
    out.push(`дальность ISL ${a.environment.isl_range_km} → ${b.environment.isl_range_km} км`);
  }
  return out;
}

/**
 * Эталонные варианты кейса — три обязательных расчёта из ТЗ. Они не хранятся в
 * профиле и доступны без входа: эксперт должен видеть сравнение сразу.
 */
export const REFERENCE_PREFIX = 'ref:';

export const isReference = (id: string): boolean => id.startsWith(REFERENCE_PREFIX);

export function makeReference(file: string, name: string, scenario: Scenario): Variant {
  return {
    id: `${REFERENCE_PREFIX}${file}`,
    name,
    created_at: '',
    scenario,
    metrics: [],
  };
}

/**
 * Сравнивать имеет смысл только сценарии с одинаковым составом наземных пунктов:
 * иначе показатели относятся к разным точкам и таблица вводит в заблуждение.
 */
export function sameGroundSites(a: Scenario, b: Scenario): boolean {
  const signature = (s: Scenario): string =>
    s.ground_sites
      .map((g) => `${g.id}:${g.role}:${g.lat_deg}:${g.lon_deg}`)
      .sort()
      .join('|');
  return signature(a) === signature(b);
}
