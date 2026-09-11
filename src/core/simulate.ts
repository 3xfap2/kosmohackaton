/**
 * Прогон сценария по расчётной сетке и сводные показатели по наземным пунктам.
 *
 * Отсчёты: 0, step_s, 2·step_s, …, horizon_s − step_s. Правый конец периода в
 * список не входит — как указано в «Описании данных».
 */
import {
  buildNetwork,
  findRoute,
  hasSatelliteDisjointBackup,
  pathLengthKm,
  type BreakReason,
} from './routing';
import type { Scenario } from './types';

/** Скорость света, км/с — для задержки распространения по маршруту. */
export const LIGHT_SPEED_KM_S = 299792.458;

export interface StepResult {
  t_s: number;
  path: string[];
  hops: number | null;
  reason: BreakReason | null;
  visible: boolean;
  /** Длина маршрута по прямым отрезкам, км; null — маршрута нет. */
  path_km: number | null;
  /** Задержка распространения в одну сторону, мс; без обработки на борту. */
  latency_ms: number | null;
  /** Есть ли путь в обход всех спутников основного маршрута; null — не считалось. */
  has_backup: boolean | null;
}

export interface ClientMetrics {
  client_id: string;
  client_name: string;
  /** Доля отсчётов, где виден хотя бы один активный аппарат. */
  visibility: number;
  /** Доля отсчётов со сквозным маршрутом до шлюза — основной показатель. */
  availability: number;
  /** Достигнут ли целевой уровень target_availability. */
  meets_target: boolean;
  /** Самый длинный перерыв, секунды. */
  max_outage_s: number;
  /** Перерывы, примыкающие к границам периода, — учитываются отдельно. */
  leading_outage_s: number;
  trailing_outage_s: number;
  outage_count: number;
  /** Среднее число переходов по отсчётам, где маршрут есть. */
  mean_hops: number | null;
  mean_latency_ms: number | null;
  max_latency_ms: number | null;
  /** Сколько раз маршрут сменился на другой без перерыва связи. */
  route_changes: number;
  /** Сколько в среднем держится один и тот же маршрут, секунды. */
  mean_route_lifetime_s: number | null;
  /** Доля отсчётов с маршрутом, где есть резервный путь через другие аппараты. */
  backup_share: number | null;
  /** Сколько отсчётов пришлось на каждую причину разрыва. */
  reasons: Record<BreakReason, number>;
}

export interface SimulationResult {
  scenario: Scenario;
  times: number[];
  /** Шаги по каждому клиентскому пункту. */
  steps: Record<string, StepResult[]>;
  metrics: ClientMetrics[];
  /** Число клиентов, достигших целевого уровня. */
  clients_meeting_target: number;
  /** Средняя и худшая доступность по пунктам — основа рекомендации. */
  mean_availability: number;
  min_availability: number;
  /** Видит ли доступный шлюз хотя бы один аппарат — по отсчётам. */
  gateway_contact: boolean[];
  elapsed_ms: number;
}

export interface SimulateOptions {
  /** Искать резервные пути. Отключается при массовых перебором ради скорости. */
  backup?: boolean;
}

export function timeGrid(scenario: Scenario): number[] {
  const { horizon_s, step_s } = scenario.environment;
  const times: number[] = [];
  for (let t = 0; t < horizon_s; t += step_s) times.push(t);
  return times;
}

const EMPTY_REASONS = (): Record<BreakReason, number> => ({
  no_visible_satellite: 0,
  isl_network_split: 0,
  no_gateway_contact: 0,
  gateway_unavailable: 0,
});

function summarize(
  scenario: Scenario,
  clientId: string,
  clientName: string,
  steps: StepResult[],
): ClientMetrics {
  const { step_s, target_availability } = scenario.environment;
  const total = steps.length;
  const keys = steps.map((s) => s.path.join('>'));
  let visible = 0;
  let withPath = 0;
  let hopSum = 0;
  let latencySum = 0;
  let latencyMax = 0;
  let backups = 0;
  let backupKnown = 0;
  const reasons = EMPTY_REASONS();

  // Перерыв — непрерывная цепочка отсчётов без маршрута.
  let run = 0;
  let maxRun = 0;
  let outageCount = 0;
  let leading = 0;
  let trailing = 0;

  // Жизнь маршрута — сколько отсчётов подряд держится один и тот же путь.
  let changes = 0;
  let life = 0;
  const lifetimes: number[] = [];

  steps.forEach((step, i) => {
    if (step.visible) visible++;
    const prevRouted = i > 0 && steps[i - 1].path.length > 0;

    if (step.path.length > 0) {
      withPath++;
      hopSum += step.hops ?? 0;
      if (step.latency_ms !== null) {
        latencySum += step.latency_ms;
        latencyMax = Math.max(latencyMax, step.latency_ms);
      }
      if (step.has_backup !== null) {
        backupKnown++;
        if (step.has_backup) backups++;
      }

      if (prevRouted && keys[i - 1] === keys[i]) {
        life++;
      } else {
        if (life > 0) {
          lifetimes.push(life);
          if (prevRouted) changes++;
        }
        life = 1;
      }

      if (run > 0) {
        maxRun = Math.max(maxRun, run);
        if (i - run === 0) leading = run * step_s;
        run = 0;
      }
    } else {
      if (life > 0) {
        lifetimes.push(life);
        life = 0;
      }
      if (step.reason) reasons[step.reason]++;
      if (run === 0) outageCount++;
      run++;
    }
  });
  if (life > 0) lifetimes.push(life);
  if (run > 0) {
    maxRun = Math.max(maxRun, run);
    trailing = run * step_s;
    if (run === total) leading = run * step_s;
  }

  const availability = total > 0 ? withPath / total : 0;
  return {
    client_id: clientId,
    client_name: clientName,
    visibility: total > 0 ? visible / total : 0,
    availability,
    meets_target: availability >= target_availability - 1e-12,
    max_outage_s: maxRun * step_s,
    leading_outage_s: leading,
    trailing_outage_s: trailing,
    outage_count: outageCount,
    mean_hops: withPath > 0 ? hopSum / withPath : null,
    mean_latency_ms: withPath > 0 ? latencySum / withPath : null,
    max_latency_ms: withPath > 0 ? latencyMax : null,
    route_changes: changes,
    mean_route_lifetime_s:
      lifetimes.length > 0 ? (lifetimes.reduce((a, b) => a + b, 0) / lifetimes.length) * step_s : null,
    backup_share: backupKnown > 0 ? backups / backupKnown : null,
    reasons,
  };
}

export function simulate(scenario: Scenario, options: SimulateOptions = {}): SimulationResult {
  const withBackup = options.backup ?? true;
  const started = performance.now();
  const times = timeGrid(scenario);
  const clients = scenario.ground_sites.filter((g) => g.role === 'client');
  const gatewayIds = scenario.ground_sites.filter((g) => g.role === 'gateway').map((g) => g.id);

  const steps: Record<string, StepResult[]> = {};
  for (const c of clients) steps[c.id] = [];
  const gatewayContact: boolean[] = [];

  for (const t of times) {
    const net = buildNetwork(scenario, t);
    gatewayContact.push(
      gatewayIds.some(
        (gw) => !net.offlineGateways.has(gw) && (net.groundLinks.get(gw) ?? []).length > 0,
      ),
    );
    for (const c of clients) {
      const r = findRoute(net, c.id, gatewayIds);
      const routed = r.path.length > 0;
      const km = routed ? pathLengthKm(net, r.path) : null;
      steps[c.id].push({
        t_s: t,
        path: r.path,
        hops: r.hops,
        reason: r.reason,
        visible: r.visible,
        path_km: km,
        latency_ms: km === null ? null : (km / LIGHT_SPEED_KM_S) * 1000,
        has_backup:
          routed && withBackup ? hasSatelliteDisjointBackup(net, r.path, c.id, gatewayIds) : null,
      });
    }
  }

  const metrics = clients.map((c) => summarize(scenario, c.id, c.name, steps[c.id]));
  const avail = metrics.map((m) => m.availability);
  return {
    scenario,
    times,
    steps,
    metrics,
    clients_meeting_target: metrics.filter((m) => m.meets_target).length,
    mean_availability: avail.length > 0 ? avail.reduce((a, b) => a + b, 0) / avail.length : 0,
    min_availability: avail.length > 0 ? Math.min(...avail) : 0,
    gateway_contact: gatewayContact,
    elapsed_ms: performance.now() - started,
  };
}
