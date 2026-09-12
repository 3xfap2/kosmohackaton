/**
 * Недоступность шлюза и локальная маска горизонта наземного пункта.
 *
 * Первое делает достижимой четвёртую причину разрыва: во всех сценариях кейса
 * раздел gateway_outages пуст, и без правки её нечем показать. Второе —
 * расширение поверх формата: рельеф и застройка поднимают порог видимости
 * конкретной площадки.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { simulate } from '../src/core/simulate';
import { validateScenario } from '../src/core/validate';
import { conditionsDiffer } from '../src/core/analysis';
import type { Scenario } from '../src/core/types';

const SCENARIOS = join(__dirname, '..', 'public', 'scenarios');
const NAMES = ['01_full_constellation', '02_first_launch', '03_satellite_outages', '04_link_range'];
const load = (name: string): Scenario =>
  JSON.parse(readFileSync(join(SCENARIOS, `${name}.json`), 'utf-8')) as Scenario;

describe('недоступность шлюза', () => {
  it.each(NAMES)('в сценарии %s эта причина не встречается — её нечем показать', (name) => {
    const sim = simulate(load(name), { backup: false });
    expect(sim.metrics.every((m) => m.reasons.gateway_unavailable === 0)).toBe(true);
  });

  it('заданный период отключает связь всем пунктам с нужной причиной', () => {
    const scenario = load('01_full_constellation');
    const from = 21600;
    const to = 28800;
    const edited: Scenario = {
      ...scenario,
      gateway_outages: [{ gateway_id: 'G_MUR', start_s: from, end_s: to }],
    };
    const sim = simulate(edited, { backup: false });

    let unavailable = 0;
    for (const m of sim.metrics) {
      for (const step of sim.steps[m.client_id]) {
        if (step.t_s < from || step.t_s >= to) continue;
        // Пока шлюз недоступен, сквозного маршрута нет ни у кого.
        expect(step.path).toHaveLength(0);
        if (step.reason === 'gateway_unavailable') unavailable++;
      }
    }
    expect(unavailable).toBeGreaterThan(0);
  });

  it('вне периода недоступности расчёт не меняется', () => {
    const scenario = load('01_full_constellation');
    const base = simulate(scenario, { backup: false });
    const edited: Scenario = {
      ...scenario,
      gateway_outages: [{ gateway_id: 'G_MUR', start_s: 21600, end_s: 28800 }],
    };
    const sim = simulate(edited, { backup: false });

    for (const m of sim.metrics) {
      const outside = sim.steps[m.client_id].filter((s) => s.t_s < 21600 || s.t_s >= 28800);
      const before = base.steps[m.client_id].filter((s) => s.t_s < 21600 || s.t_s >= 28800);
      expect(outside.map((s) => s.path)).toEqual(before.map((s) => s.path));
    }
  });
});

describe('локальная маска горизонта', () => {
  it('без поля порог берётся из сценария', () => {
    const scenario = load('01_full_constellation');
    const explicit: Scenario = {
      ...scenario,
      ground_sites: scenario.ground_sites.map((g) => ({
        ...g,
        min_elevation_deg: scenario.environment.min_elevation_deg,
      })),
    };
    const a = simulate(scenario, { backup: false });
    const b = simulate(explicit, { backup: false });
    expect(b.metrics.map((m) => m.availability)).toEqual(a.metrics.map((m) => m.availability));
  });

  it('повышенный порог снижает доступность только своего пункта', () => {
    const scenario = load('01_full_constellation');
    const base = simulate(scenario, { backup: false });
    const masked: Scenario = {
      ...scenario,
      ground_sites: scenario.ground_sites.map((g) =>
        g.id === 'C65' ? { ...g, min_elevation_deg: 25 } : g,
      ),
    };
    const sim = simulate(masked, { backup: false });

    const availability = (s: typeof sim, id: string) =>
      s.metrics.find((m) => m.client_id === id)!.availability;

    expect(availability(sim, 'C65')).toBeLessThan(availability(base, 'C65'));
    expect(availability(sim, 'C70')).toBe(availability(base, 'C70'));
    expect(availability(sim, 'C72')).toBe(availability(base, 'C72'));
  });

  it('проверка файла отвергает маску вне диапазона', () => {
    const scenario = load('01_full_constellation') as unknown as Record<string, unknown>;
    const sites = scenario.ground_sites as Array<Record<string, unknown>>;
    sites[1].min_elevation_deg = 95;
    const errors = validateScenario(scenario);
    expect(errors.some((e) => /min_elevation_deg: маска горизонта/.test(e))).toBe(true);
  });

  it('сравнение предупреждает о разных масках', () => {
    const scenario = load('01_full_constellation');
    const masked: Scenario = {
      ...scenario,
      ground_sites: scenario.ground_sites.map((g) =>
        g.id === 'C65' ? { ...g, min_elevation_deg: 15 } : g,
      ),
    };
    expect(conditionsDiffer([scenario, masked])).toContain('локальные маски горизонта пунктов');
  });
});
