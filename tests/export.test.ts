/** Выгрузка результата в формате cosmo-A-result-1.0 и обратная загрузка. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildResult } from '../src/core/export';
import { simulate } from '../src/core/simulate';
import { parseScenarioText } from '../src/core/validate';
import type { Scenario } from '../src/core/types';

const SCENARIOS = join(__dirname, '..', 'public', 'scenarios');
const load = (name: string): Scenario =>
  JSON.parse(readFileSync(join(SCENARIOS, `${name}.json`), 'utf-8')) as Scenario;

describe('выгрузка результата', () => {
  const sim = simulate(load('03_satellite_outages'));
  const res = buildResult(sim);

  it('объявляет схему результата', () => {
    expect(res.schema_version).toBe('cosmo-A-result-1.0');
  });

  it('содержит ровно одну запись на каждую пару «момент — пункт»', () => {
    expect(res.routes).toHaveLength(sim.times.length * sim.metrics.length);
    const keys = new Set(res.routes.map((r) => `${r.t_s}|${r.client_id}`));
    expect(keys.size).toBe(res.routes.length);
  });

  it('записи имеют поля t_s, client_id, path, а путь идёт от пункта до шлюза', () => {
    const gateways = new Set(
      sim.scenario.ground_sites.filter((g) => g.role === 'gateway').map((g) => g.id),
    );
    for (const r of res.routes) {
      expect(Object.keys(r).sort()).toEqual(['client_id', 'path', 't_s']);
      if (r.path.length > 0) {
        expect(r.path[0]).toBe(r.client_id);
        expect(gateways.has(r.path[r.path.length - 1])).toBe(true);
      }
    }
  });

  it('маршруты совпадают с расчётом', () => {
    const i = 200;
    const client = sim.metrics[0].client_id;
    const rec = res.routes.find((r) => r.t_s === sim.times[i] && r.client_id === client);
    expect(rec?.path).toEqual(sim.steps[client][i].path);
  });

  it('effective_scenario хранит правки пользователя', () => {
    const edited = load('01_full_constellation');
    edited.design.planes[1].raan_deg = 85;
    edited.failures = [{ satellite_id: 'S05', start_s: 3600, end_s: 7200 }];
    const out = buildResult(simulate(edited));
    expect(out.effective_scenario.design.planes[1].raan_deg).toBe(85);
    expect(out.effective_scenario.failures).toEqual(edited.failures);
  });

  it('выгруженный файл загружается обратно и даёт те же показатели', () => {
    const back = parseScenarioText(JSON.stringify(res));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    const again = simulate(back.scenario);
    expect(again.metrics.map((m) => m.availability)).toEqual(sim.metrics.map((m) => m.availability));
    expect(again.metrics.map((m) => m.max_outage_s)).toEqual(sim.metrics.map((m) => m.max_outage_s));
  });
});
