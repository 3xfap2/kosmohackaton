/**
 * Правила маршрутизации, которые легко нарушить незаметно.
 *
 * Снапшот сети содержит рёбра «наземный пункт — спутник» для всех пунктов,
 * включая клиентские. Наивный поиск пути прошёл бы через соседний клиентский
 * пункт как через ретранслятор, и доступность оказалась бы завышена. По
 * правилам кейса промежуточными узлами могут быть только спутники.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { simulate } from '../src/core/simulate';
import type { Scenario } from '../src/core/types';

const SCENARIOS = join(__dirname, '..', 'public', 'scenarios');
const NAMES = ['01_full_constellation', '02_first_launch', '03_satellite_outages', '04_link_range'];
const load = (name: string): Scenario =>
  JSON.parse(readFileSync(join(SCENARIOS, `${name}.json`), 'utf-8')) as Scenario;

describe('наземные пункты не ретранслируют трафик', () => {
  it.each(NAMES)('в сценарии %s промежуточные узлы — только спутники', (name) => {
    const scenario = load(name);
    const sim = simulate(scenario, { backup: false });
    const groundIds = new Set(scenario.ground_sites.map((g) => g.id));
    const satIds = new Set(scenario.design.satellites.map((s) => s.id));
    const gateways = new Set(
      scenario.ground_sites.filter((g) => g.role === 'gateway').map((g) => g.id),
    );

    let checked = 0;
    for (const m of sim.metrics) {
      for (const step of sim.steps[m.client_id]) {
        if (step.path.length === 0) continue;
        checked++;
        expect(step.path[0]).toBe(m.client_id);
        expect(gateways.has(step.path[step.path.length - 1])).toBe(true);
        for (const id of step.path.slice(1, -1)) {
          expect(groundIds.has(id)).toBe(false);
          expect(satIds.has(id)).toBe(true);
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('маршрут не проходит через другой клиентский пункт даже когда тот виден', () => {
    const scenario = load('01_full_constellation');
    const sim = simulate(scenario, { backup: false });
    const clients = scenario.ground_sites.filter((g) => g.role === 'client').map((g) => g.id);

    for (const client of clients) {
      const others = clients.filter((c) => c !== client);
      for (const step of sim.steps[client]) {
        for (const other of others) expect(step.path).not.toContain(other);
      }
    }
  });
});

describe('этапы развёртывания: 16, 32 и 48 аппаратов', () => {
  it('каждая очередь вводит свою плоскость и поднимает доступность', () => {
    const base = load('01_full_constellation');
    const expected = [16, 32, 48];

    const rows = ([1, 2, 3] as const).map((stage, i) => {
      const scenario: Scenario = { ...base, design: { ...base.design, launch_stage: stage } };
      const launched = scenario.design.satellites.filter((s) => s.launch_batch <= stage);
      expect(launched).toHaveLength(expected[i]);
      // Очередь в этом кейсе совпадает с орбитальной плоскостью целиком.
      expect(new Set(launched.map((s) => s.plane_id)).size).toBe(stage);

      const sim = simulate(scenario, { backup: false });
      return {
        этап: stage,
        аппаратов: launched.length,
        средняя: `${(sim.mean_availability * 100).toFixed(1)}%`,
        худший: `${(sim.min_availability * 100).toFixed(1)}%`,
        'цель достигают': `${sim.clients_meeting_target} из ${sim.metrics.length}`,
        mean: sim.mean_availability,
      };
    });

    console.table(rows.map(({ mean, ...row }) => ({ ...row, _: mean === undefined ? '' : '' })));
    console.log(rows.map((r) => `этап ${r.этап}: ${r.аппаратов} аппаратов, средняя ${r.средняя}, худший ${r.худший}, цель ${r['цель достигают']}`).join('\n'));

    expect(rows[1].mean).toBeGreaterThan(rows[0].mean);
    expect(rows[2].mean).toBeGreaterThan(rows[1].mean);
  });
});
