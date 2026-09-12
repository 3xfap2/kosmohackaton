/**
 * Проверка входного файла.
 *
 * Жюри загрузит свой сценарий, поэтому каждое правило «Описания данных»
 * проверяется отдельно, и ошибка обязана указывать поле или объект.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseScenarioText, validateScenario } from '../src/core/validate';
import { buildResult } from '../src/core/export';
import { simulate } from '../src/core/simulate';

const SCENARIOS = join(__dirname, '..', 'public', 'scenarios');
const NAMES = ['01_full_constellation', '02_first_launch', '03_satellite_outages', '04_link_range'];
const text = (name: string): string => readFileSync(join(SCENARIOS, `${name}.json`), 'utf-8');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any;
const base = (): Raw => JSON.parse(text('01_full_constellation'));

/** Портит копию сценария и возвращает ошибки проверки. */
const errorsAfter = (mutate: (s: Raw) => void): string[] => {
  const s = base();
  mutate(s);
  return validateScenario(s);
};

describe('проверка входного файла', () => {
  it.each(NAMES)('сценарий кейса %s проходит проверку', (name) => {
    expect(validateScenario(JSON.parse(text(name)))).toEqual([]);
  });

  const cases: Array<[string, (s: Raw) => void, RegExp]> = [
    ['неверная версия схемы', (s) => { s.schema_version = 'cosmo-A-0.9'; }, /^schema_version:/],
    ['нет параметра окружения', (s) => { delete s.environment.step_s; }, /^environment\.step_s: нужно конечное число/],
    ['нечисловое значение', (s) => { s.environment.isl_range_km = 'далеко'; }, /^environment\.isl_range_km:/],
    ['горизонт не кратен шагу', (s) => { s.environment.horizon_s = 86401; }, /^environment\.horizon_s: .*не кратна шагу/],
    ['дробный шаг', (s) => { s.environment.step_s = 120.5; }, /^environment\.step_s: шаг должен быть целым/],
    ['высота вне диапазона', (s) => { s.environment.altitude_km = 5000; }, /^environment\.altitude_km:/],
    ['угол плоскости 360°', (s) => { s.design.planes[1].raan_deg = 360; }, /^design\.planes\[1\] \(P2\)\.raan_deg:/],
    ['повтор идентификатора спутника', (s) => { s.design.satellites[1].id = s.design.satellites[0].id; }, /^design\.satellites\[1\]\.id: .*повторяется/],
    ['ссылка на неизвестную плоскость', (s) => { s.design.satellites[5].plane_id = 'P9'; }, /^design\.satellites\[5\] \(S06\)\.plane_id: ссылка на неизвестную плоскость "P9"/],
    ['неверная очередь запуска', (s) => { s.design.satellites[0].launch_batch = 4; }, /\(S01\)\.launch_batch:/],
    ['неверный этап развёртывания', (s) => { s.design.launch_stage = 0; }, /^design\.launch_stage:/],
    ['пункт с идентификатором спутника', (s) => { s.ground_sites[1].id = 'S01'; }, /совпадает с идентификатором спутника/],
    ['широта вне диапазона', (s) => { s.ground_sites[2].lat_deg = 95; }, /^ground_sites\[2\] \(C70\)\.lat_deg:/],
    ['нет шлюза', (s) => { s.ground_sites = s.ground_sites.filter((g: Raw) => g.role !== 'gateway'); }, /нужен хотя бы один шлюз/],
    ['отказ неизвестного спутника', (s) => { s.failures = [{ satellite_id: 'S99', start_s: 0, end_s: 100 }]; }, /^failures\[0\]\.satellite_id: спутник "S99" не найден/],
    ['отказ за горизонтом', (s) => { s.failures = [{ satellite_id: 'S01', start_s: 0, end_s: 90000 }]; }, /выходит за расчётный горизонт/],
    ['отказ нулевой длительности', (s) => { s.failures = [{ satellite_id: 'S01', start_s: 500, end_s: 500 }]; }, /положительную длительность/],
    ['недоступность клиента вместо шлюза', (s) => { s.gateway_outages = [{ gateway_id: 'C65', start_s: 0, end_s: 100 }]; }, /клиентский, а не шлюз/],
    ['нет раздела failures', (s) => { delete s.failures; }, /^failures: нужен список/],
  ];

  it.each(cases)('%s — ошибка указывает поле', (_, mutate, pattern) => {
    const errors = errorsAfter(mutate);
    expect(errors.some((e) => pattern.test(e)), errors.join('\n')).toBe(true);
  });

  it('собирает все ошибки сразу, а не только первую', () => {
    const errors = errorsAfter((s) => {
      s.environment.step_s = -1;
      s.design.satellites[0].plane_id = 'нет';
      s.ground_sites[1].lon_deg = 500;
    });
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });

  it('сообщает о некорректном JSON', () => {
    const r = parseScenarioText('{ "schema_version": ');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/не является корректным JSON/);
  });

  it('принимает файл с BOM — так сохраняет Блокнот в Windows', () => {
    expect(parseScenarioText('\uFEFF' + text('01_full_constellation')).ok).toBe(true);
  });

  it('принимает выгруженный результат и берёт из него сценарий', () => {
    const r = parseScenarioText(JSON.stringify(buildResult(simulate(base()))));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.kind).toBe('result');
  });
});
