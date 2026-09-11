/**
 * Выгрузка результата в формате cosmo-A-result-1.0 из «Описания данных».
 *
 * Обязательная часть: effective_scenario — полный использованный сценарий со всеми
 * правками пользователя, и routes — по одной записи на каждую пару «момент
 * расчёта — наземный пункт». Сводные показатели добавлены сверху, как разрешает
 * формат. Файл загружается обратно в сервис без потерь.
 */
import type { SimulationResult } from './simulate';
import type { Scenario } from './types';
import { RESULT_SCHEMA } from './validate';

export interface RouteRecord {
  t_s: number;
  client_id: string;
  /** От наземного пункта до шлюза; пустой список — маршрута нет. */
  path: string[];
}

export interface ResultFile {
  schema_version: typeof RESULT_SCHEMA;
  effective_scenario: Scenario;
  routes: RouteRecord[];
  summary: {
    time_grid: { horizon_s: number; step_s: number; steps: number };
    target_availability: number;
    mean_availability: number;
    clients_meeting_target: number;
    clients: Array<{
      client_id: string;
      visibility: number;
      availability: number;
      meets_target: boolean;
      max_outage_s: number;
      leading_outage_s: number;
      trailing_outage_s: number;
      outage_count: number;
      mean_hops: number | null;
      mean_latency_ms: number | null;
      route_changes: number;
      backup_share: number | null;
      reasons: Record<string, number>;
    }>;
    notes: string[];
  };
}

export function buildResult(sim: SimulationResult): ResultFile {
  const { horizon_s, step_s, target_availability } = sim.scenario.environment;
  const clients = sim.metrics.map((m) => m.client_id);

  const routes: RouteRecord[] = [];
  sim.times.forEach((t_s, i) => {
    for (const client_id of clients) {
      routes.push({ t_s, client_id, path: [...sim.steps[client_id][i].path] });
    }
  });

  return {
    schema_version: RESULT_SCHEMA,
    effective_scenario: structuredClone(sim.scenario),
    routes,
    summary: {
      time_grid: { horizon_s, step_s, steps: sim.times.length },
      target_availability,
      mean_availability: sim.mean_availability,
      clients_meeting_target: sim.clients_meeting_target,
      clients: sim.metrics.map((m) => ({
        client_id: m.client_id,
        visibility: m.visibility,
        availability: m.availability,
        meets_target: m.meets_target,
        max_outage_s: m.max_outage_s,
        leading_outage_s: m.leading_outage_s,
        trailing_outage_s: m.trailing_outage_s,
        outage_count: m.outage_count,
        mean_hops: m.mean_hops,
        mean_latency_ms: m.mean_latency_ms,
        route_changes: m.route_changes,
        backup_share: m.backup_share,
        reasons: { ...m.reasons },
      })),
      notes: [
        'Доли — отношение числа отсчётов к их общему числу.',
        'Перерывы, примыкающие к началу и концу периода, указаны отдельно.',
        'Число переходов включает обе наземные линии.',
        'Задержка — распространение сигнала в одну сторону по прямым отрезкам маршрута, без обработки на борту.',
        'Резервный путь — маршрут, не использующий ни одного спутника основного.',
      ],
    },
  };
}

/** Имя файла по идентификатору сценария, без символов, недопустимых в Windows. */
export function exportFileName(scenario: Scenario, suffix: string): string {
  const base = (scenario.meta?.id || 'scenario').replace(/[^\w.-]+/g, '_');
  return `${base}${suffix}.json`;
}
