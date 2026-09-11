/**
 * Диагноз проекта: сервис сам формулирует инженерное заключение.
 *
 * Собственных расчётов здесь нет — только сведение уже проверенных: доступность
 * по пунктам, зависимость от шлюза, перебор отказов и перебор схем ориентации.
 * Отдельно добавлена проверка, которую поодиночке эти инструменты не дают:
 * одновременный отказ десяти самых нагруженных аппаратов.
 */
import {
  findVulnerableSatellites,
  formatDuration,
  gatewayDependency,
  sweepPatterns,
  SWEEP_PHASES,
  SWEEP_SPACINGS,
} from './analysis';
import { simulate, type SimulationResult } from './simulate';
import type { Scenario } from './types';

export type Tone = 'ok' | 'warn' | 'info';

export interface Finding {
  id: 'target' | 'gateway' | 'vulnerable' | 'layout' | 'stress';
  title: string;
  text: string;
  tone: Tone;
}

export interface Diagnosis {
  findings: Finding[];
  /** Готовый текст для записки и презентации. */
  report: string;
  /** Аппараты, отключённые в проверке на одновременный отказ. */
  stressed: string[];
}

export interface DiagnoseOptions {
  spacings?: number[];
  phases?: number[];
  onProgress?: (done: number, total: number, phase: string) => void;
  isCancelled?: () => boolean;
}

const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;
const points = (v: number): string => `${(v * 100).toFixed(1)}`;

/** Сколько аппаратов отключаем одновременно в стресс-проверке. */
const STRESS_COUNT = 10;

export async function diagnose(
  scenario: Scenario,
  sim: SimulationResult,
  options: DiagnoseOptions = {},
): Promise<Diagnosis | null> {
  const spacings = options.spacings ?? SWEEP_SPACINGS;
  const phases = options.phases ?? SWEEP_PHASES;
  const cancelled = () => options.isCancelled?.() ?? false;

  const launched = scenario.design.satellites.filter(
    (s) => s.launch_batch <= scenario.design.launch_stage,
  );
  const canSweep = scenario.design.planes.length >= 2;
  const total = launched.length + (canSweep ? spacings.length * phases.length * 2 : 0);
  let done = 0;
  const tick = (phase: string) => {
    done += 1;
    options.onProgress?.(done, total, phase);
  };

  const findings: Finding[] = [];
  const env = scenario.environment;

  // 1. Достижение целевого уровня -------------------------------------------
  const target = env.target_availability;
  const failing = sim.metrics.filter((m) => !m.meets_target);
  const worstClient = [...sim.metrics].sort((a, b) => a.availability - b.availability)[0];
  const worstOutage = Math.max(0, ...sim.metrics.map((m) => m.max_outage_s));
  findings.push(
    failing.length === 0
      ? {
          id: 'target',
          tone: 'ok',
          title: 'Целевой уровень достигнут',
          text: `Все ${sim.metrics.length} наземных пункта получают связь не реже целевых ${pct(target)}. Худший — ${worstClient.client_id} с ${pct(worstClient.availability)}, самый длинный перерыв ${formatDuration(worstOutage)}.`,
        }
      : {
          id: 'target',
          tone: 'warn',
          title: 'Целевой уровень не достигнут',
          text: `Ниже целевых ${pct(target)}: ${failing.map((f) => `${f.client_id} — ${pct(f.availability)}`).join(', ')}. Самый длинный перерыв ${formatDuration(worstOutage)}.`,
        },
  );

  // 2. Зависимость от шлюза --------------------------------------------------
  const gw = gatewayDependency(sim);
  const gatewayIsBottleneck = gw.gateway_share_of_outages > 0.3;
  findings.push({
    id: 'gateway',
    tone: gatewayIsBottleneck ? 'warn' : 'info',
    title: gatewayIsBottleneck ? 'Узкое место — шлюз, а не аппараты' : 'Шлюз узким местом не является',
    text:
      `Шлюз видит хотя бы один аппарат ${pct(gw.contact_share)} времени, и на него приходится ${pct(gw.gateway_share_of_outages)} всех перерывов.` +
      (gw.shared_blackout_steps > 0
        ? ` ${formatDuration(gw.shared_blackout_s)} в сутки связь одновременно теряют все пункты. Резервные маршруты этого не устраняют: рвётся последний участок, а не межспутниковая сеть.`
        : ' Одновременных потерь связи всеми пунктами по его вине нет.'),
  });

  // 3. Уязвимые аппараты -----------------------------------------------------
  const baseline = simulate(scenario, { backup: false });
  const vulnerable = await findVulnerableSatellites(
    scenario,
    baseline,
    () => tick('перебор отказов'),
    cancelled,
  );
  if (!vulnerable) return null;

  const top = vulnerable[0];
  findings.push(
    top && top.mean_drop > 0.001
      ? {
          id: 'vulnerable',
          tone: 'info',
          title: `Самый уязвимый аппарат — ${top.id}`,
          text: `Его отказ на весь период снижает среднюю доступность на ${points(top.mean_drop)} пункта, сильнее всего страдает ${top.worst_client} — минус ${points(top.worst_drop)} пункта. Проверены все ${vulnerable.length} запущенных аппаратов по одному.`,
        }
      : {
          id: 'vulnerable',
          tone: 'ok',
          title: 'Отказ одного аппарата проект не ломает',
          text: `Проверены все ${vulnerable.length} запущенных аппаратов по одному: ни один отказ поодиночке не снижает среднюю доступность заметно.`,
        },
  );

  // 4. Схема ориентации плоскостей -------------------------------------------
  if (canSweep) {
    const sweep = await sweepPatterns(
      scenario,
      spacings,
      phases,
      () => tick('перебор схем'),
      cancelled,
    );
    if (!sweep) return null;
    const gain = sweep.best.mean - sim.mean_availability;
    findings.push({
      id: 'layout',
      tone: gain > 0.005 ? 'warn' : 'ok',
      title:
        gain > 0.005
          ? 'Ориентацию плоскостей стоит изменить'
          : 'Текущая ориентация плоскостей близка к лучшей',
      text: `Проверено ${sweep.cells.length} равномерных схем. Лучшая — шаг RAAN ${sweep.best.raan_spacing}°, сдвиг фазы ${sweep.best.phase_step}°: средняя доступность ${pct(sweep.best.mean)} против ${pct(sim.mean_availability)} сейчас, разница ${points(gain)} пункта.`,
    });
  }

  // 5. Одновременный отказ самых нагруженных аппаратов ------------------------
  const stressed = vulnerable.slice(0, Math.min(STRESS_COUNT, vulnerable.length)).map((v) => v.id);
  const stressScenario: Scenario = {
    ...scenario,
    failures: [
      ...scenario.failures,
      ...stressed.map((id) => ({ satellite_id: id, start_s: 0, end_s: env.horizon_s })),
    ],
  };
  const stressSim = simulate(stressScenario, { backup: false });
  let stressText = `При одновременном отказе ${stressed.length} самых уязвимых аппаратов (${stressed.slice(0, 3).join(', ')} и других) средняя доступность падает до ${pct(stressSim.mean_availability)}, худший пункт — ${pct(stressSim.min_availability)}.`;

  if (canSweep) {
    const stressSweep = await sweepPatterns(
      stressScenario,
      spacings,
      phases,
      () => tick('схемы при отказах'),
      cancelled,
    );
    if (!stressSweep) return null;
    stressText += stressSweep.best.meets_all
      ? ` Схема «шаг ${stressSweep.best.raan_spacing}°, сдвиг ${stressSweep.best.phase_step}°» удерживает цель даже в этих условиях: ${pct(stressSweep.best.mean)}.`
      : ` Ни одна из ${stressSweep.cells.length} проверенных схем не удерживает цель в этих условиях; лучшая даёт ${pct(stressSweep.best.mean)}.`;
  }

  findings.push({
    id: 'stress',
    tone: stressSim.clients_meeting_target === stressSim.metrics.length ? 'ok' : 'warn',
    title: 'Проверка на одновременный отказ',
    text: stressText,
  });

  const report = [
    `Диагноз проекта «${scenario.meta.title || scenario.meta.id}»`,
    `Условия: ${launched.length} из ${scenario.design.satellites.length} аппаратов, горизонт ${formatDuration(env.horizon_s)}, шаг ${env.step_s} с, порог угла возвышения ${env.min_elevation_deg}°, дальность ISL ${env.isl_range_km} км.`,
    '',
    ...findings.map((f) => `${f.title}. ${f.text}`),
  ].join('\n');

  return { findings, report, stressed };
}
