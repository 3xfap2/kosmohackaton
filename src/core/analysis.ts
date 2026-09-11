/**
 * Анализ поверх расчёта: рекомендация, устойчивость, подбор конфигурации.
 *
 * Всё здесь строится из уже посчитанных отсчётов или из повторных прогонов того
 * же ядра — собственных формул физики модуль не содержит.
 */
import { simulate, type SimulationResult, type StepResult } from './simulate';
import type { BreakReason } from './routing';
import type { Scenario } from './types';

const GATEWAY_REASONS: ReadonlySet<BreakReason> = new Set<BreakReason>([
  'no_gateway_contact',
  'gateway_unavailable',
]);

const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;

export function formatDuration(s: number): string {
  if (s <= 0) return '0 мин';
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
}

// --- Навигация по перерывам -------------------------------------------------

/**
 * Индекс начала следующего (dir = 1) или предыдущего (dir = −1) перерыва
 * относительно отсчёта from; null — перерывов в этом направлении нет.
 */
export function nextOutage(steps: StepResult[], from: number, dir: 1 | -1): number | null {
  const isStart = (i: number): boolean =>
    steps[i].path.length === 0 && (i === 0 || steps[i - 1].path.length > 0);
  if (dir === 1) {
    for (let i = from + 1; i < steps.length; i++) if (isStart(i)) return i;
  } else {
    for (let i = from - 1; i >= 0; i--) if (isStart(i)) return i;
  }
  return null;
}

// --- Зависимость от шлюза ---------------------------------------------------

export interface GatewayDependency {
  /** Доля отсчётов, когда доступный шлюз видит хотя бы один аппарат. */
  contact_share: number;
  /** Отсчёты, когда все пункты одновременно без связи по вине шлюза. */
  shared_blackout_steps: number;
  shared_blackout_s: number;
  /** Первый такой отсчёт — чтобы перейти к нему на таймлайне. */
  first_shared_blackout: number | null;
  /** Доля всех перерывов (пар «отсчёт — пункт»), вызванных шлюзом. */
  gateway_share_of_outages: number;
  per_client: Array<{ client_id: string; outage_steps: number; gateway_steps: number }>;
}

export function gatewayDependency(sim: SimulationResult): GatewayDependency {
  const clients = sim.metrics.map((m) => m.client_id);
  let shared = 0;
  let first: number | null = null;
  for (let i = 0; i < sim.times.length; i++) {
    const all = clients.every((c) => {
      const s = sim.steps[c][i];
      return s.path.length === 0 && s.reason !== null && GATEWAY_REASONS.has(s.reason);
    });
    if (all && clients.length > 0) {
      shared++;
      if (first === null) first = i;
    }
  }

  const perClient = clients.map((c) => {
    const steps = sim.steps[c];
    const outage = steps.filter((s) => s.path.length === 0);
    return {
      client_id: c,
      outage_steps: outage.length,
      gateway_steps: outage.filter((s) => s.reason !== null && GATEWAY_REASONS.has(s.reason)).length,
    };
  });
  const totalOutage = perClient.reduce((a, c) => a + c.outage_steps, 0);
  const totalGateway = perClient.reduce((a, c) => a + c.gateway_steps, 0);

  return {
    contact_share:
      sim.gateway_contact.length > 0
        ? sim.gateway_contact.filter(Boolean).length / sim.gateway_contact.length
        : 0,
    shared_blackout_steps: shared,
    shared_blackout_s: shared * sim.scenario.environment.step_s,
    first_shared_blackout: first,
    gateway_share_of_outages: totalOutage > 0 ? totalGateway / totalOutage : 0,
    per_client: perClient,
  };
}

// --- Загрузка аппаратов -----------------------------------------------------

export interface SatelliteUsage {
  id: string;
  plane_id: string;
  /** Доля пар «отсчёт — пункт», где аппарат несёт маршрут. */
  share: number;
}

export function satelliteUsage(sim: SimulationResult): SatelliteUsage[] {
  const counts = new Map<string, number>();
  const clients = sim.metrics.map((m) => m.client_id);
  for (const c of clients) {
    for (const step of sim.steps[c]) {
      for (const id of step.path.slice(1, -1)) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  const denom = sim.times.length * Math.max(clients.length, 1);
  return sim.scenario.design.satellites
    .map((s) => ({ id: s.id, plane_id: s.plane_id, share: (counts.get(s.id) ?? 0) / denom }))
    .sort((a, b) => b.share - a.share);
}

// --- Рекомендация -----------------------------------------------------------

export interface Candidate {
  id: string;
  name: string;
  sim: SimulationResult;
}

export interface RankedCandidate {
  candidate: Candidate;
  mean: number;
  min: number;
  worst_outage_s: number;
  meets_all: boolean;
  failing: Array<{ client_id: string; availability: number }>;
}

export interface Recommendation {
  ranking: RankedCandidate[];
  best: RankedCandidate;
  reasons: string[];
  /** Различия условий расчёта: варианты с разными условиями сравнимы с оговоркой. */
  conditions_differ: string[];
}

const EPS = 1e-9;

function compareRanked(a: RankedCandidate, b: RankedCandidate): number {
  if (Math.abs(b.mean - a.mean) > EPS) return b.mean - a.mean;
  if (Math.abs(b.min - a.min) > EPS) return b.min - a.min;
  return a.worst_outage_s - b.worst_outage_s;
}

export function rankCandidates(cands: Candidate[]): RankedCandidate[] {
  return cands
    .map((candidate) => {
      const m = candidate.sim.metrics;
      return {
        candidate,
        mean: candidate.sim.mean_availability,
        min: candidate.sim.min_availability,
        worst_outage_s: m.length > 0 ? Math.max(...m.map((x) => x.max_outage_s)) : 0,
        meets_all: m.every((x) => x.meets_target),
        failing: m
          .filter((x) => !x.meets_target)
          .map((x) => ({ client_id: x.client_id, availability: x.availability })),
      };
    })
    .sort(compareRanked);
}

/** Какие условия расчёта различаются между сценариями. */
export function conditionsDiffer(scenarios: Scenario[]): string[] {
  if (scenarios.length < 2) return [];
  const out: string[] = [];
  const env: Array<[keyof Scenario['environment'], string]> = [
    ['altitude_km', 'высота орбиты'],
    ['inclination_deg', 'наклонение'],
    ['earth_angle0_deg', 'начальный угол Земли'],
    ['horizon_s', 'продолжительность расчёта'],
    ['step_s', 'шаг расчёта'],
    ['min_elevation_deg', 'порог угла возвышения'],
    ['isl_range_km', 'дальность ISL'],
  ];
  for (const [key, label] of env) {
    const values = [...new Set(scenarios.map((s) => s.environment[key]))];
    if (values.length > 1) out.push(`${label}: ${values.join(' / ')}`);
  }
  const sites = (s: Scenario) =>
    s.ground_sites
      .map((g) => `${g.id}:${g.role}:${g.lat_deg}:${g.lon_deg}`)
      .sort()
      .join('|');
  if (new Set(scenarios.map(sites)).size > 1) out.push('состав или координаты наземных пунктов');
  if (new Set(scenarios.map((s) => JSON.stringify(s.failures))).size > 1) {
    out.push('периоды отказов спутников');
  }
  if (new Set(scenarios.map((s) => JSON.stringify(s.gateway_outages))).size > 1) {
    out.push('периоды недоступности шлюзов');
  }
  return out;
}

/**
 * Рекомендация по ключевому показателю — средней доступности по пунктам.
 *
 * Так приоритет обозначил постановщик на сессии вопросов и ответов: доступность
 * «во главе угла», остальные показатели вспомогательные. При равенстве средней
 * решает худший пункт, затем самый длинный перерыв.
 */
export function recommend(cands: Candidate[]): Recommendation | null {
  if (cands.length === 0) return null;
  const ranking = rankCandidates(cands);
  const best = ranking[0];
  const second = ranking[1];
  const reasons: string[] = [];

  reasons.push(
    second
      ? `Наибольшая средняя доступность по пунктам — ${pct(best.mean)}; следующий вариант «${second.candidate.name}» — ${pct(second.mean)}.`
      : `Средняя доступность по пунктам — ${pct(best.mean)}.`,
  );
  if (second && Math.abs(best.mean - second.mean) <= EPS) {
    reasons.push(
      Math.abs(best.min - second.min) > EPS
        ? `Средняя совпадает — выбор по худшему пункту: ${pct(best.min)} против ${pct(second.min)}.`
        : `Средняя и худший пункт совпадают — выбор по самому длинному перерыву: ${formatDuration(best.worst_outage_s)} против ${formatDuration(second.worst_outage_s)}.`,
    );
  }

  const target = best.candidate.sim.scenario.environment.target_availability;
  reasons.push(
    best.meets_all
      ? `Целевой уровень ${pct(target)} достигнут всеми пунктами.`
      : `Целевой уровень ${pct(target)} не достигнут: ${best.failing
          .map((f) => `${f.client_id} — ${pct(f.availability)}`)
          .join(', ')}. Это лучший из рассмотренных вариантов, а не подтверждение цели.`,
  );
  reasons.push(`Самый длинный перерыв — ${formatDuration(best.worst_outage_s)}.`);

  return {
    ranking,
    best,
    reasons,
    conditions_differ: conditionsDiffer(cands.map((c) => c.sim.scenario)),
  };
}

// --- Подбор ориентации плоскостей -------------------------------------------

const norm360 = (a: number): number => {
  const v = ((a % 360) + 360) % 360;
  return Math.abs(v - 360) < 1e-9 ? 0 : Math.round(v * 1e9) / 1e9;
};

/**
 * Равномерная схема: плоскость k получает RAAN = RAAN₀ + k·шаг и фазу
 * phase₀ + k·сдвиг. Меняются только проектные параметры — RAAN и фазирование;
 * состав очередей запуска не трогается, как просили на сессии вопросов.
 */
export function applyPattern(scenario: Scenario, raanSpacing: number, phaseStep: number): Scenario {
  const base = scenario.design.planes[0];
  return {
    ...scenario,
    design: {
      ...scenario.design,
      planes: scenario.design.planes.map((p, k) => ({
        ...p,
        raan_deg: norm360(base.raan_deg + k * raanSpacing),
        phase_deg: norm360(base.phase_deg + k * phaseStep),
      })),
    },
  };
}

export const SWEEP_SPACINGS = [30, 40, 50, 60, 70, 80, 90];
export const SWEEP_PHASES = [0, 2.5, 5, 7.5, 10, 12.5, 15, 17.5, 20];

export interface SweepCell {
  raan_spacing: number;
  phase_step: number;
  mean: number;
  min: number;
  meets_all: boolean;
}

export interface SweepResult {
  cells: SweepCell[];
  best: SweepCell;
  spacings: number[];
  phases: number[];
}

const pause = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export async function sweepPatterns(
  scenario: Scenario,
  spacings: number[] = SWEEP_SPACINGS,
  phases: number[] = SWEEP_PHASES,
  onProgress?: (done: number, total: number) => void,
  isCancelled?: () => boolean,
): Promise<SweepResult | null> {
  const cells: SweepCell[] = [];
  const total = spacings.length * phases.length;
  for (const raan_spacing of spacings) {
    for (const phase_step of phases) {
      if (isCancelled?.()) return null;
      const sim = simulate(applyPattern(scenario, raan_spacing, phase_step), { backup: false });
      cells.push({
        raan_spacing,
        phase_step,
        mean: sim.mean_availability,
        min: sim.min_availability,
        meets_all: sim.clients_meeting_target === sim.metrics.length,
      });
      onProgress?.(cells.length, total);
      if (cells.length % 3 === 0) await pause();
    }
  }
  const best = [...cells].sort((a, b) =>
    Math.abs(b.mean - a.mean) > EPS ? b.mean - a.mean : b.min - a.min,
  )[0];
  return { cells, best, spacings, phases };
}

// --- Уязвимые аппараты ------------------------------------------------------

export interface Vulnerability {
  id: string;
  plane_id: string;
  /** На сколько падает средняя доступность при отказе аппарата на весь период. */
  mean_drop: number;
  worst_client: string;
  worst_drop: number;
}

export async function findVulnerableSatellites(
  scenario: Scenario,
  baseline: SimulationResult,
  onProgress?: (done: number, total: number) => void,
  isCancelled?: () => boolean,
): Promise<Vulnerability[] | null> {
  const launched = scenario.design.satellites.filter(
    (s) => s.launch_batch <= scenario.design.launch_stage,
  );
  const horizon = scenario.environment.horizon_s;
  const out: Vulnerability[] = [];

  for (let i = 0; i < launched.length; i++) {
    if (isCancelled?.()) return null;
    const sat = launched[i];
    const trial: Scenario = {
      ...scenario,
      failures: [...scenario.failures, { satellite_id: sat.id, start_s: 0, end_s: horizon }],
    };
    const sim = simulate(trial, { backup: false });
    let worstClient = '';
    let worstDrop = -Infinity;
    for (const m of sim.metrics) {
      const base = baseline.metrics.find((b) => b.client_id === m.client_id);
      const drop = (base?.availability ?? 0) - m.availability;
      if (drop > worstDrop) {
        worstDrop = drop;
        worstClient = m.client_id;
      }
    }
    out.push({
      id: sat.id,
      plane_id: sat.plane_id,
      mean_drop: baseline.mean_availability - sim.mean_availability,
      worst_client: worstClient,
      worst_drop: Math.max(worstDrop, 0),
    });
    onProgress?.(i + 1, launched.length);
    if (i % 3 === 2) await pause();
  }
  return out.sort((a, b) => b.mean_drop - a.mean_drop);
}
