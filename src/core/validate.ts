/**
 * Проверка входного файла по правилам «Описания данных».
 *
 * Правила совпадают с validate() из geometry.py, но сообщения другие: ТЗ требует,
 * чтобы сервис указывал проблемное поле или объект, а эталон говорит лишь
 * «Invalid satellite». Здесь каждая ошибка — путь до поля и что именно не так,
 * и собираются все ошибки сразу, а не только первая.
 */
import type { Scenario } from './types';

export const SCENARIO_SCHEMA = 'cosmo-A-1.0';
export const RESULT_SCHEMA = 'cosmo-A-result-1.0';

const ENV_KEYS = [
  'altitude_km',
  'inclination_deg',
  'earth_angle0_deg',
  'horizon_s',
  'step_s',
  'min_elevation_deg',
  'isl_range_km',
  'target_availability',
] as const;

type Json = Record<string, unknown>;

const isObj = (x: unknown): x is Json => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isId = (x: unknown): x is string => typeof x === 'string' && x.length > 0;

/** Значение из файла для сообщения — коротко и однозначно. */
function show(x: unknown): string {
  if (x === undefined) return 'поле отсутствует';
  const text = JSON.stringify(x) ?? String(x);
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

export function validateScenario(raw: unknown): string[] {
  const errors: string[] = [];
  const err = (path: string, message: string) => errors.push(`${path}: ${message}`);

  if (!isObj(raw)) return ['Файл должен содержать объект JSON со сценарием.'];

  if (raw.schema_version !== SCENARIO_SCHEMA) {
    err('schema_version', `ожидается "${SCENARIO_SCHEMA}", в файле ${show(raw.schema_version)}`);
  }

  if (!isObj(raw.meta)) {
    err('meta', 'раздел отсутствует или не является объектом');
  } else {
    if (!isId(raw.meta.id)) err('meta.id', `нужна непустая строка, в файле ${show(raw.meta.id)}`);
    if (typeof raw.meta.title !== 'string') err('meta.title', `нужна строка, в файле ${show(raw.meta.title)}`);
  }

  // --- environment ----------------------------------------------------------
  let horizon: number | null = null;
  const env = raw.environment;
  if (!isObj(env)) {
    err('environment', 'раздел отсутствует или не является объектом');
  } else {
    for (const k of ENV_KEYS) {
      if (!isNum(env[k])) err(`environment.${k}`, `нужно конечное число, в файле ${show(env[k])}`);
    }
    const num = (k: (typeof ENV_KEYS)[number]): number | null => (isNum(env[k]) ? (env[k] as number) : null);

    const alt = num('altitude_km');
    if (alt !== null && !(alt >= 200 && alt <= 1200)) {
      err('environment.altitude_km', `высота вне допустимого диапазона 200–1200 км (${alt})`);
    }
    const inc = num('inclination_deg');
    if (inc !== null && !(inc > 0 && inc <= 180)) {
      err('environment.inclination_deg', `наклонение должно быть больше 0 и не больше 180° (${inc})`);
    }

    const step = num('step_s');
    const hz = num('horizon_s');
    if (step !== null && !Number.isInteger(step)) {
      err('environment.step_s', `шаг должен быть целым числом секунд (${step})`);
    }
    if (hz !== null && !Number.isInteger(hz)) {
      err('environment.horizon_s', `продолжительность должна быть целым числом секунд (${hz})`);
    }
    if (step !== null && hz !== null && Number.isInteger(step) && Number.isInteger(hz)) {
      if (!(step > 0)) err('environment.step_s', `шаг должен быть положительным (${step})`);
      else if (!(hz >= step)) err('environment.horizon_s', `продолжительность ${hz} с меньше шага ${step} с`);
      else if (hz > 172800) err('environment.horizon_s', `продолжительность не больше 172 800 с — двое суток (${hz})`);
      else if (hz % step !== 0) err('environment.horizon_s', `продолжительность ${hz} с не кратна шагу ${step} с`);
      else horizon = hz;
    }

    const elev = num('min_elevation_deg');
    if (elev !== null && !(elev >= 0 && elev < 90)) {
      err('environment.min_elevation_deg', `угол возвышения от 0 включительно до 90 исключительно (${elev})`);
    }
    const isl = num('isl_range_km');
    if (isl !== null && !(isl > 0 && isl <= 10000)) {
      err('environment.isl_range_km', `дальность ISL больше 0 и не больше 10 000 км (${isl})`);
    }
    const target = num('target_availability');
    if (target !== null && !(target >= 0 && target <= 1)) {
      err('environment.target_availability', `целевой уровень в долях единицы, от 0 до 1 (${target})`);
    }
  }

  // --- design ---------------------------------------------------------------
  const satIds = new Set<string>();
  const d = raw.design;
  if (!isObj(d)) {
    err('design', 'раздел отсутствует или не является объектом');
  } else {
    const planeIds = new Set<string>();
    if (!Array.isArray(d.planes) || d.planes.length === 0) {
      err('design.planes', 'нужен непустой список орбитальных плоскостей');
    } else {
      d.planes.forEach((p, i) => {
        const at = `design.planes[${i}]`;
        if (!isObj(p)) return err(at, 'элемент должен быть объектом');
        const label = isId(p.id) ? `${at} (${p.id})` : at;
        if (!isId(p.id)) err(`${at}.id`, `нужен непустой идентификатор, в файле ${show(p.id)}`);
        else if (planeIds.has(p.id)) err(`${at}.id`, `идентификатор плоскости "${p.id}" повторяется`);
        else planeIds.add(p.id);
        for (const k of ['raan_deg', 'phase_deg'] as const) {
          const v = p[k];
          if (!isNum(v) || v < 0 || v >= 360) {
            err(`${label}.${k}`, `нужен угол от 0 включительно до 360 исключительно, в файле ${show(v)}`);
          }
        }
      });
    }

    if (!Array.isArray(d.satellites) || d.satellites.length === 0) {
      err('design.satellites', 'нужен непустой список спутников');
    } else {
      d.satellites.forEach((s, i) => {
        const at = `design.satellites[${i}]`;
        if (!isObj(s)) return err(at, 'элемент должен быть объектом');
        const label = isId(s.id) ? `${at} (${s.id})` : at;
        if (!isId(s.id)) err(`${at}.id`, `нужен непустой идентификатор, в файле ${show(s.id)}`);
        else if (satIds.has(s.id)) err(`${at}.id`, `идентификатор спутника "${s.id}" повторяется`);
        else satIds.add(s.id);
        if (!isId(s.plane_id) || !planeIds.has(s.plane_id)) {
          err(`${label}.plane_id`, `ссылка на неизвестную плоскость ${show(s.plane_id)}`);
        }
        if (![1, 2, 3].includes(s.launch_batch as number)) {
          err(`${label}.launch_batch`, `очередь запуска — 1, 2 или 3, в файле ${show(s.launch_batch)}`);
        }
        if (!isNum(s.slot_deg)) err(`${label}.slot_deg`, `нужно конечное число, в файле ${show(s.slot_deg)}`);
      });
    }

    if (![1, 2, 3].includes(d.launch_stage as number)) {
      err('design.launch_stage', `этап развёртывания — 1, 2 или 3, в файле ${show(d.launch_stage)}`);
    }
  }

  // --- ground_sites ---------------------------------------------------------
  const gatewayIds = new Set<string>();
  const clientIds = new Set<string>();
  if (!Array.isArray(raw.ground_sites) || raw.ground_sites.length === 0) {
    err('ground_sites', 'нужен непустой список наземных пунктов');
  } else {
    const siteIds = new Set<string>();
    raw.ground_sites.forEach((g, i) => {
      const at = `ground_sites[${i}]`;
      if (!isObj(g)) return err(at, 'элемент должен быть объектом');
      const label = isId(g.id) ? `${at} (${g.id})` : at;
      if (!isId(g.id)) err(`${at}.id`, `нужен непустой идентификатор, в файле ${show(g.id)}`);
      else if (siteIds.has(g.id)) err(`${at}.id`, `идентификатор пункта "${g.id}" повторяется`);
      else if (satIds.has(g.id)) err(`${at}.id`, `идентификатор "${g.id}" совпадает с идентификатором спутника`);
      else siteIds.add(g.id);
      if (typeof g.name !== 'string') err(`${label}.name`, `нужна строка, в файле ${show(g.name)}`);
      if (g.role === 'client' && isId(g.id)) clientIds.add(g.id);
      else if (g.role === 'gateway' && isId(g.id)) gatewayIds.add(g.id);
      else if (g.role !== 'client' && g.role !== 'gateway') {
        err(`${label}.role`, `роль — "client" или "gateway", в файле ${show(g.role)}`);
      }
      if (!isNum(g.lat_deg) || g.lat_deg < -90 || g.lat_deg > 90) {
        err(`${label}.lat_deg`, `широта от −90 до 90°, в файле ${show(g.lat_deg)}`);
      }
      if (!isNum(g.lon_deg) || g.lon_deg < -180 || g.lon_deg > 180) {
        err(`${label}.lon_deg`, `долгота от −180 до 180°, в файле ${show(g.lon_deg)}`);
      }
      // Необязательное расширение: локальная маска горизонта площадки.
      if (g.min_elevation_deg !== undefined) {
        const mask = g.min_elevation_deg;
        if (!isNum(mask) || mask < 0 || mask >= 90) {
          err(
            `${label}.min_elevation_deg`,
            `маска горизонта от 0 включительно до 90 исключительно, в файле ${show(mask)}`,
          );
        }
      }
    });
    if (clientIds.size === 0) err('ground_sites', 'нужен хотя бы один клиентский пункт (role: "client")');
    if (gatewayIds.size === 0) err('ground_sites', 'нужен хотя бы один шлюз (role: "gateway")');
  }

  // --- периоды недоступности ------------------------------------------------
  const checkIntervals = (key: 'failures' | 'gateway_outages', idKey: string, valid: Set<string>) => {
    const list = raw[key];
    if (!Array.isArray(list)) return err(key, 'нужен список — пустой, если периодов нет');
    list.forEach((f, i) => {
      const at = `${key}[${i}]`;
      if (!isObj(f)) return err(at, 'элемент должен быть объектом');
      const ref = f[idKey];
      if (!isId(ref) || !valid.has(ref)) {
        const hint =
          key === 'gateway_outages' && isId(ref) && clientIds.has(ref)
            ? `пункт "${ref}" клиентский, а не шлюз`
            : `${key === 'failures' ? 'спутник' : 'шлюз'} ${show(ref)} не найден`;
        err(`${at}.${idKey}`, hint);
      }
      const s = f.start_s;
      const e = f.end_s;
      if (!isNum(s)) err(`${at}.start_s`, `нужно конечное число, в файле ${show(s)}`);
      if (!isNum(e)) err(`${at}.end_s`, `нужно конечное число, в файле ${show(e)}`);
      if (isNum(s) && isNum(e)) {
        if (!(s < e)) err(at, `период должен иметь положительную длительность: start_s ${s} ≥ end_s ${e}`);
        else if (horizon !== null && (s < 0 || e > horizon)) {
          err(at, `период [${s}; ${e}) выходит за расчётный горизонт [0; ${horizon}]`);
        }
      }
    });
  };
  checkIntervals('failures', 'satellite_id', satIds);
  checkIntervals('gateway_outages', 'gateway_id', gatewayIds);

  return errors;
}

export type ParseResult =
  | { ok: true; scenario: Scenario; kind: 'scenario' | 'result' }
  | { ok: false; errors: string[] };

/**
 * Разбор загруженного файла. Принимает и сценарий, и выгруженный результат —
 * из результата берётся effective_scenario, чтобы изменённый проект можно было
 * загрузить обратно.
 */
export function parseScenarioText(text: string): ParseResult {
  let raw: unknown;
  try {
    // Блокнот в Windows сохраняет UTF-8 с BOM — JSON.parse на нём падает.
    raw = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (e) {
    return { ok: false, errors: [`Файл не является корректным JSON: ${(e as Error).message}`] };
  }

  if (isObj(raw) && raw.schema_version === RESULT_SCHEMA) {
    if (!isObj(raw.effective_scenario)) {
      return { ok: false, errors: ['effective_scenario: в файле результата нет использованного сценария'] };
    }
    const errors = validateScenario(raw.effective_scenario).map((e) => `effective_scenario.${e}`);
    return errors.length > 0
      ? { ok: false, errors }
      : { ok: true, scenario: raw.effective_scenario as unknown as Scenario, kind: 'result' };
  }

  const errors = validateScenario(raw);
  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, scenario: raw as unknown as Scenario, kind: 'scenario' };
}
