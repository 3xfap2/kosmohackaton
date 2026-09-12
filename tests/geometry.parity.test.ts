/**
 * Сверка TS-ядра с эталонным geometry.py.
 *
 * Фикстуры снимаются командой `npm run fixtures` и содержат полные снапшоты
 * (координаты, состав рёбер, углы возвышения) по четырём сценариям кейса.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { snapshot } from '../src/core/geometry';
import type { Scenario, Snapshot, Edge } from '../src/core/types';

const SCENARIO_DIR = join(__dirname, '..', 'public', 'scenarios');
const FIXTURES = join(__dirname, 'fixtures');

/** Допуск: 1 нм на координатах в километрах и 1e-9° на углах. */
const TOL = 1e-9;

const SCENARIOS = [
  '01_full_constellation',
  '02_first_launch',
  '03_satellite_outages',
  '04_link_range',
] as const;

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

function loadScenario(name: string): Scenario {
  return readJson<Scenario>(join(SCENARIO_DIR, `${name}.json`));
}

function sortEdges(edges: Edge[]): Edge[] {
  return [...edges].sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
}

describe('ядро повторяет эталонный geometry.py', () => {
  for (const name of SCENARIOS) {
    const expected = readJson<Record<string, Snapshot>>(join(FIXTURES, `${name}.snapshots.json`));
    const scenario = loadScenario(name);

    describe(name, () => {
      for (const [key, ref] of Object.entries(expected)) {
        const t = Number(key);

        it(`t = ${t} c`, () => {
          const got = snapshot(scenario, t);

          // Координаты и состав активных аппаратов.
          expect(got.satellites).toHaveLength(ref.satellites.length);
          got.satellites.forEach((sat, k) => {
            const want = ref.satellites[k];
            expect(sat.id).toBe(want.id);
            expect(sat.active).toBe(want.active);
            expect(sat.x_km).toBeCloseTo(want.x_km, 9);
            expect(sat.y_km).toBeCloseTo(want.y_km, 9);
            expect(sat.z_km).toBeCloseTo(want.z_km, 9);
          });

          // Состав рёбер должен совпадать точно — это основа маршрутизации.
          const gotEdges = sortEdges(got.edges);
          const refEdges = ref.edges as Edge[];
          expect(gotEdges.map((e) => `${e[0]}|${e[1]}`)).toEqual(
            refEdges.map((e) => `${e[0]}|${e[1]}`),
          );
          gotEdges.forEach((edge, k) => {
            expect(Math.abs(edge[2] - refEdges[k][2])).toBeLessThan(TOL);
          });

          // Углы возвышения по каждому наземному пункту.
          expect(Object.keys(got.elevation_deg).sort()).toEqual(
            Object.keys(ref.elevation_deg).sort(),
          );
          for (const [siteId, angles] of Object.entries(ref.elevation_deg)) {
            const mine = got.elevation_deg[siteId];
            expect(Object.keys(mine).sort()).toEqual(Object.keys(angles).sort());
            for (const [satId, angle] of Object.entries(angles)) {
              expect(Math.abs(mine[satId] - angle)).toBeLessThan(TOL);
            }
          }
        });
      }
    });
  }
});
