/** Показатели маршрутов, рекомендация, устойчивость и подбор конфигурации. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LIGHT_SPEED_KM_S, simulate, type StepResult } from '../src/core/simulate';
import {
  applyPattern,
  findVulnerableSatellites,
  gatewayDependency,
  nextOutage,
  recommend,
  satelliteUsage,
  sweepPatterns,
} from '../src/core/analysis';
import type { Scenario } from '../src/core/types';

const CASE_ROOT = join(__dirname, '..', '..');
const load = (name: string): Scenario =>
  JSON.parse(readFileSync(join(CASE_ROOT, 'Данные', `${name}.json`), 'utf-8')) as Scenario;

const full = simulate(load('01_full_constellation'));

describe('характеристики маршрутов', () => {
  it('задержка — длина маршрута, делённая на скорость света', () => {
    const alt = full.scenario.environment.altitude_km;
    for (const m of full.metrics) {
      for (const s of full.steps[m.client_id]) {
        if (s.path.length === 0) {
          expect(s.path_km).toBeNull();
          continue;
        }
        // Две наземные линии не короче высоты орбиты каждая.
        expect(s.path_km!).toBeGreaterThanOrEqual(2 * alt);
        expect(s.latency_ms!).toBeCloseTo((s.path_km! / LIGHT_SPEED_KM_S) * 1000, 9);
      }
    }
  });

  it('стабильность и резервирование — в допустимых пределах', () => {
    const { step_s, horizon_s } = full.scenario.environment;
    for (const m of full.metrics) {
      expect(m.route_changes).toBeGreaterThanOrEqual(0);
      expect(m.mean_route_lifetime_s!).toBeGreaterThanOrEqual(step_s);
      expect(m.mean_route_lifetime_s!).toBeLessThanOrEqual(horizon_s);
      expect(m.backup_share!).toBeGreaterThanOrEqual(0);
      expect(m.backup_share!).toBeLessThanOrEqual(1);
    }
  });

  it('без поиска резервных путей доля резервирования не считается', () => {
    const light = simulate(load('01_full_constellation'), { backup: false });
    expect(light.metrics.every((m) => m.backup_share === null)).toBe(true);
    expect(light.metrics.map((m) => m.availability)).toEqual(full.metrics.map((m) => m.availability));
  });
});

describe('отказ аппарата текущего маршрута — базовый сценарий проверки из ТЗ', () => {
  it('после отказа маршрут обходит аппарат или появляется перерыв с причиной', () => {
    const scenario = load('01_full_constellation');
    const client = 'C65';
    const i = full.steps[client].findIndex((s) => s.path.length > 2);
    const t = full.times[i];
    const failed = full.steps[client][i].path[1];

    const edited: Scenario = {
      ...scenario,
      failures: [{ satellite_id: failed, start_s: t, end_s: scenario.environment.horizon_s }],
    };
    const after = simulate(edited);
    for (const s of after.steps[client].slice(i)) {
      expect(s.path).not.toContain(failed);
      if (s.path.length === 0) expect(s.reason).not.toBeNull();
    }
    // До начала отказа маршруты не меняются.
    expect(after.steps[client].slice(0, i).map((s) => s.path)).toEqual(
      full.steps[client].slice(0, i).map((s) => s.path),
    );
  });
});

describe('навигация по перерывам', () => {
  const mk = (pattern: string): StepResult[] =>
    [...pattern].map((c, i) => ({
      t_s: i * 120,
      path: c === '1' ? ['C', 'S', 'G'] : [],
      hops: c === '1' ? 2 : null,
      reason: c === '1' ? null : 'no_visible_satellite',
      visible: c === '1',
      path_km: null,
      latency_ms: null,
      has_backup: null,
    }));

  it('находит начало следующего и предыдущего перерыва', () => {
    const steps = mk('11001110001');
    expect(nextOutage(steps, 0, 1)).toBe(2);
    expect(nextOutage(steps, 2, 1)).toBe(7);
    expect(nextOutage(steps, 7, 1)).toBeNull();
    expect(nextOutage(steps, 8, -1)).toBe(7);
    expect(nextOutage(steps, 7, -1)).toBe(2);
    expect(nextOutage(steps, 2, -1)).toBeNull();
  });

  it('перерыв с первого отсчёта тоже считается началом', () => {
    expect(nextOutage(mk('0011'), 3, -1)).toBe(0);
  });
});

describe('зависимость от шлюза', () => {
  it('в полной группировке все пункты теряют связь одновременно по вине шлюза', () => {
    const dep = gatewayDependency(full);
    // C72 видит аппараты 100% времени — его перерывы по шлюзу и есть окна без контакта шлюза.
    const noContact = full.gateway_contact.filter((c) => !c).length;
    expect(dep.shared_blackout_steps).toBe(8);
    expect(noContact).toBe(8);
    expect(dep.contact_share).toBeCloseTo(712 / 720, 12);
    expect(dep.first_shared_blackout).not.toBeNull();
    expect(dep.gateway_share_of_outages).toBeGreaterThan(0);
  });
});

describe('загрузка аппаратов', () => {
  it('упорядочена по убыванию и учитывает только промежуточные узлы', () => {
    const usage = satelliteUsage(full);
    expect(usage).toHaveLength(full.scenario.design.satellites.length);
    for (let k = 1; k < usage.length; k++) expect(usage[k - 1].share).toBeGreaterThanOrEqual(usage[k].share);
    const occurrences = full.metrics
      .flatMap((m) => full.steps[m.client_id])
      .reduce((a, s) => a + Math.max(s.path.length - 2, 0), 0);
    const total = usage.reduce((a, u) => a + u.share, 0) * full.times.length * full.metrics.length;
    expect(total).toBeCloseTo(occurrences, 6);
  });
});

describe('рекомендация', () => {
  const first = simulate(load('02_first_launch'));

  it('выбирает вариант с наибольшей средней доступностью', () => {
    const rec = recommend([
      { id: 'a', name: 'Первая очередь', sim: first },
      { id: 'b', name: 'Полная', sim: full },
    ])!;
    expect(rec.best.candidate.id).toBe('b');
    expect(rec.reasons[0]).toContain('Первая очередь');
    expect(rec.conditions_differ).toEqual([]);
  });

  it('предупреждает, если условия расчёта различаются', () => {
    const range = simulate(load('04_link_range'));
    const rec = recommend([
      { id: 'a', name: '3000 км', sim: full },
      { id: 'b', name: '2000 км', sim: range },
    ])!;
    expect(rec.conditions_differ.some((c) => c.startsWith('дальность ISL'))).toBe(true);
  });

  it('честно пишет, когда цель не достигнута', () => {
    const rec = recommend([{ id: 'a', name: 'Первая очередь', sim: first }])!;
    expect(rec.best.meets_all).toBe(false);
    expect(rec.reasons.join(' ')).toMatch(/не достигнут/);
  });
});

describe('подбор ориентации плоскостей', () => {
  const scenario = load('01_full_constellation');

  it('схема с шагом 60° и сдвигом 7,5° воспроизводит исходную конфигурацию', () => {
    expect(applyPattern(scenario, 60, 7.5).design.planes).toEqual(scenario.design.planes);
  });

  it('перебор находит вариант не хуже исходного', async () => {
    const res = (await sweepPatterns(scenario, [50, 60], [0, 7.5]))!;
    expect(res.cells).toHaveLength(4);
    const original = res.cells.find((c) => c.raan_spacing === 60 && c.phase_step === 7.5)!;
    expect(original.mean).toBeCloseTo(full.mean_availability, 12);
    expect(res.best.mean).toBeGreaterThanOrEqual(original.mean);
  });
});

describe('уязвимые аппараты', () => {
  it('ранжируются по падению средней доступности', async () => {
    const scenario = load('02_first_launch');
    const baseline = simulate(scenario, { backup: false });
    const list = (await findVulnerableSatellites(scenario, baseline))!;
    expect(list).toHaveLength(16);
    for (let k = 1; k < list.length; k++) expect(list[k - 1].mean_drop).toBeGreaterThanOrEqual(list[k].mean_drop);
    expect(list[0].mean_drop).toBeGreaterThan(0);
  });
});
