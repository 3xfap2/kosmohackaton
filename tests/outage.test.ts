/** Поведение при отказах: просадка должна начинаться ровно с заданного часа. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { simulate } from '../src/core/simulate';
import type { Scenario } from '../src/core/types';

const SCENARIOS = join(__dirname, '..', 'public', 'scenarios');
const load = (name: string): Scenario =>
  JSON.parse(readFileSync(join(SCENARIOS, `${name}.json`), 'utf-8')) as Scenario;

const share = (steps: { t_s: number; path: string[] }[], from: number, to: number): number => {
  const slice = steps.filter((s) => s.t_s >= from && s.t_s < to);
  return slice.filter((s) => s.path.length > 0).length / slice.length;
};

describe('03_satellite_outages — отказ десяти аппаратов с шестого часа', () => {
  const res = simulate(load('03_satellite_outages'));
  const OUTAGE_START = 21600;

  it('до отказа доступность совпадает с полной группировкой', () => {
    const full = simulate(load('01_full_constellation'));
    for (const m of res.metrics) {
      const before = share(res.steps[m.client_id], 0, OUTAGE_START);
      const fullBefore = share(full.steps[m.client_id], 0, OUTAGE_START);
      expect(before).toBeCloseTo(fullBefore, 12);
    }
  });

  it('после отказа доступность падает по каждому пункту', () => {
    for (const m of res.metrics) {
      const before = share(res.steps[m.client_id], 0, OUTAGE_START);
      const after = share(res.steps[m.client_id], OUTAGE_START, 86400);
      expect(after).toBeLessThan(before);
    }
  });

  it('целевые 90% достигаются до отказа и теряются после', () => {
    const target = res.scenario.environment.target_availability;
    for (const m of res.metrics) {
      expect(share(res.steps[m.client_id], 0, OUTAGE_START)).toBeGreaterThanOrEqual(target);
      expect(share(res.steps[m.client_id], OUTAGE_START, 86400)).toBeLessThan(target);
    }
  });
});

describe('единственный шлюз — системное узкое место', () => {
  it('перерывы по причине «нет контакта со шлюзом» совпадают у всех пунктов', () => {
    const res = simulate(load('01_full_constellation'));
    const windows = res.metrics.map(
      (m) =>
        new Set(
          res.steps[m.client_id]
            .filter((s) => s.reason === 'no_gateway_contact')
            .map((s) => s.t_s),
        ),
    );
    // Шлюз не видит ни одного аппарата — маршрута нет одновременно у всех клиентов.
    const [first, ...rest] = windows;
    expect(first.size).toBeGreaterThan(0);
    for (const other of rest) {
      expect([...other].every((t) => first.has(t))).toBe(true);
    }
  });
});
