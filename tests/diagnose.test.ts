/** Диагноз проекта: связное заключение из уже проверенных расчётов. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { diagnose } from '../src/core/diagnose';
import { simulate } from '../src/core/simulate';
import type { Scenario } from '../src/core/types';

const CASE_ROOT = join(__dirname, '..', '..');
const load = (name: string): Scenario =>
  JSON.parse(readFileSync(join(CASE_ROOT, 'Данные', `${name}.json`), 'utf-8')) as Scenario;

// Мелкая сетка перебора: содержание выводов от её размера не зависит.
const GRID = { spacings: [50, 60], phases: [0, 7.5] };

describe('диагноз проекта', () => {
  it('разбирает полную группировку по всем разделам', async () => {
    const scenario = load('01_full_constellation');
    const result = (await diagnose(scenario, simulate(scenario), GRID))!;

    expect(result.findings.map((f) => f.id)).toEqual([
      'target',
      'gateway',
      'vulnerable',
      'layout',
      'stress',
    ]);
    expect(result.findings.find((f) => f.id === 'target')!.tone).toBe('ok');
    // Единственный шлюз даёт больше половины перерывов — это и есть главный вывод.
    expect(result.findings.find((f) => f.id === 'gateway')!.title).toContain('Узкое место');
    expect(result.stressed).toHaveLength(10);
    expect(result.report).toContain('Диагноз проекта');
    expect(result.report).toContain('дальность ISL 3000 км');
  });

  it('на первой очереди прямо говорит, что цель не достигнута', async () => {
    const scenario = load('02_first_launch');
    const result = (await diagnose(scenario, simulate(scenario), GRID))!;

    const target = result.findings.find((f) => f.id === 'target')!;
    expect(target.tone).toBe('warn');
    expect(target.text).toContain('Ниже целевых');
    // Запущено 16 аппаратов — в стресс-проверку идут десять из них.
    expect(result.stressed).toHaveLength(10);
  });

  it('стресс-проверка отключает именно самые уязвимые аппараты', async () => {
    const scenario = load('01_full_constellation');
    const sim = simulate(scenario);
    const result = (await diagnose(scenario, sim, GRID))!;

    const stress = result.findings.find((f) => f.id === 'stress')!;
    expect(stress.text).toContain('При одновременном отказе 10');
    expect(new Set(result.stressed).size).toBe(result.stressed.length);
    for (const id of result.stressed) {
      expect(scenario.design.satellites.some((s) => s.id === id)).toBe(true);
    }
  });

  it('прерывается по запросу и ничего не возвращает', async () => {
    const scenario = load('01_full_constellation');
    const result = await diagnose(scenario, simulate(scenario), {
      ...GRID,
      isCancelled: () => true,
    });
    expect(result).toBeNull();
  });
});
