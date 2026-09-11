/** Прогон всех сценариев кейса: проверка показателей и времени расчёта. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { simulate } from '../src/core/simulate';
import type { Scenario } from '../src/core/types';

const CASE_ROOT = join(__dirname, '..', '..');
const load = (name: string): Scenario =>
  JSON.parse(readFileSync(join(CASE_ROOT, 'Данные', `${name}.json`), 'utf-8')) as Scenario;

const NAMES = ['01_full_constellation', '02_first_launch', '03_satellite_outages', '04_link_range'];

describe('расчёт по сценариям кейса', () => {
  for (const name of NAMES) {
    it(name, () => {
      const scenario = load(name);
      const res = simulate(scenario);
      expect(res.times).toHaveLength(720);

      const rows = res.metrics.map((m) => ({
        пункт: m.client_id,
        видимость: `${(m.visibility * 100).toFixed(1)}%`,
        доступность: `${(m.availability * 100).toFixed(1)}%`,
        цель: m.meets_target ? 'да' : 'нет',
        'макс.перерыв': `${(m.max_outage_s / 60).toFixed(0)} мин`,
        перерывов: m.outage_count,
        'ср.хопов': m.mean_hops ? m.mean_hops.toFixed(2) : '—',
        причины: Object.entries(m.reasons)
          .filter(([, v]) => v > 0)
          .map(([k, v]) => `${k}:${v}`)
          .join(' ') || '—',
      }));
      console.log(`\n=== ${name} — ${res.elapsed_ms.toFixed(0)} мс`);
      console.table(rows);

      for (const m of res.metrics) {
        expect(m.availability).toBeGreaterThanOrEqual(0);
        expect(m.availability).toBeLessThanOrEqual(1);
        expect(m.availability).toBeLessThanOrEqual(m.visibility + 1e-12);
      }
    });
  }
});
