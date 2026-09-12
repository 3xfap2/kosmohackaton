/**
 * Поиск маршрута «клиентский пункт → спутники → шлюз» на один отсчёт времени.
 *
 * Промежуточными узлами могут быть только спутники: по правилам кейса клиентские
 * пункты не ретранслируют трафик, поэтому наземные узлы в обход не попадают.
 *
 * Алгоритм — поиск в ширину по числу переходов. Сеть небольшая (десятки узлов),
 * а основной показатель считает наличие пути, а не его длину. BFS даёт маршрут с
 * минимальным числом переходов, что совпадает с инженерным предпочтением коротких
 * цепочек ретрансляции.
 */
import { activeMask, gatewayOffline, positions, groundPosition, R_EARTH_KM } from './geometry';
import type { Scenario } from './types';

/** Причина отсутствия сквозного маршрута — требование ТЗ к разбору перерывов. */
export type BreakReason =
  | 'no_visible_satellite'
  | 'isl_network_split'
  | 'no_gateway_contact'
  | 'gateway_unavailable';

export const BREAK_REASON_RU: Record<BreakReason, string> = {
  no_visible_satellite: 'нет видимого спутника',
  isl_network_split: 'разрыв межспутниковой сети',
  no_gateway_contact: 'нет контакта со шлюзом',
  gateway_unavailable: 'шлюз недоступен',
};

export interface RouteResult {
  /** Последовательность идентификаторов от клиента до шлюза; пусто — маршрута нет. */
  path: string[];
  /** Число рёбер маршрута, включая две наземные линии. */
  hops: number | null;
  /** Заполняется только когда маршрута нет. */
  reason: BreakReason | null;
  /** Виден ли хотя бы один активный аппарат — геометрическая видимость. */
  visible: boolean;
}

/** Состояние сети на один отсчёт, подготовленное для маршрутизации. */
export interface NetworkState {
  satIds: string[];
  satIndex: Map<string, number>;
  /** Координаты аппаратов в системе, связанной с Землёй, км: [x0,y0,z0, x1,…]. */
  xyz: Float64Array;
  groundXYZ: Map<string, [number, number, number]>;
  /** Список смежности между спутниками по индексам. */
  islAdjacency: number[][];
  /** Индексы аппаратов, видимых из наземного пункта. */
  groundLinks: Map<string, number[]>;
  /** Шлюзы, недоступные на этом отсчёте. */
  offlineGateways: Set<string>;
}

export function buildNetwork(scenario: Scenario, t_s: number): NetworkState {
  const e = scenario.environment;
  const { ids, xyz } = positions(scenario, t_s);
  const active = activeMask(scenario, t_s);
  const count = ids.length;

  const islAdjacency: number[][] = Array.from({ length: count }, () => []);
  for (let i = 0; i < count; i++) {
    if (!active[i]) continue;
    for (let j = i + 1; j < count; j++) {
      if (!active[j]) continue;
      const dx = xyz[j * 3] - xyz[i * 3];
      const dy = xyz[j * 3 + 1] - xyz[i * 3 + 1];
      const dz = xyz[j * 3 + 2] - xyz[i * 3 + 2];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (!(dist < e.isl_range_km)) continue;

      const denom = Math.max(dx * dx + dy * dy + dz * dz, 1e-12);
      const dot = xyz[i * 3] * dx + xyz[i * 3 + 1] * dy + xyz[i * 3 + 2] * dz;
      const lam = Math.min(Math.max(-dot / denom, 0), 1);
      const px = xyz[i * 3] + lam * dx;
      const py = xyz[i * 3 + 1] + lam * dy;
      const pz = xyz[i * 3 + 2] + lam * dz;
      if (Math.sqrt(px * px + py * py + pz * pz) > R_EARTH_KM) {
        islAdjacency[i].push(j);
        islAdjacency[j].push(i);
      }
    }
  }

  const groundLinks = new Map<string, number[]>();
  const groundXYZ = new Map<string, [number, number, number]>();
  const offlineGateways = new Set<string>();
  for (const site of scenario.ground_sites) {
    const g = groundPosition(site);
    const [gx, gy, gz] = g;
    groundXYZ.set(site.id, g);
    const ux = gx / R_EARTH_KM;
    const uy = gy / R_EARTH_KM;
    const uz = gz / R_EARTH_KM;
    if (site.role === 'gateway' && gatewayOffline(scenario, site.id, t_s)) {
      offlineGateways.add(site.id);
    }
    // Локальная маска горизонта площадки; без неё — общий порог сценария.
    const threshold = site.min_elevation_deg ?? e.min_elevation_deg;
    const visible: number[] = [];
    for (let k = 0; k < count; k++) {
      if (!active[k]) continue;
      const dx = xyz[k * 3] - gx;
      const dy = xyz[k * 3 + 1] - gy;
      const dz = xyz[k * 3 + 2] - gz;
      const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const sin = Math.min(Math.max((dx * ux + dy * uy + dz * uz) / dl, -1), 1);
      if (Math.asin(sin) * (180 / Math.PI) >= threshold) visible.push(k);
    }
    groundLinks.set(site.id, visible);
  }

  const satIndex = new Map(ids.map((id, k) => [id, k]));
  return { satIds: ids, satIndex, xyz, groundXYZ, islAdjacency, groundLinks, offlineGateways };
}

/**
 * Маршрут от клиента до любого доступного шлюза.
 *
 * Когда пути нет, причина определяется послойно: сначала проверяется видимость
 * из пункта, затем достижимость шлюзов по межспутниковой сети, затем наличие у
 * достижимых аппаратов контакта со шлюзом, и в последнюю очередь — доступность
 * самих шлюзов. Это даёт ровно те четыре причины, которые требует ТЗ.
 *
 * `excluded` — индексы аппаратов, которые нельзя использовать. Нужен для поиска
 * резервного пути; причина разрыва при исключениях смысла не имеет.
 */
export function findRoute(
  net: NetworkState,
  clientId: string,
  gatewayIds: string[],
  excluded?: ReadonlySet<number>,
): RouteResult {
  const allowed = (k: number): boolean => !excluded?.has(k);
  const start = (net.groundLinks.get(clientId) ?? []).filter(allowed);
  if (start.length === 0) {
    return { path: [], hops: null, reason: 'no_visible_satellite', visible: false };
  }

  const onlineGateways = gatewayIds.filter((id) => !net.offlineGateways.has(id));

  // BFS по спутниковой сети от всех видимых из клиента аппаратов.
  const prev = new Int32Array(net.satIds.length).fill(-1);
  const seen = new Uint8Array(net.satIds.length);
  const queue: number[] = [];
  for (const k of start) {
    seen[k] = 1;
    queue.push(k);
  }

  // Аппараты, имеющие контакт с конкретным доступным шлюзом.
  const gatewayEntry = new Map<number, string>();
  for (const gw of onlineGateways) {
    for (const k of net.groundLinks.get(gw) ?? []) {
      if (allowed(k) && !gatewayEntry.has(k)) gatewayEntry.set(k, gw);
    }
  }

  for (let head = 0; head < queue.length; head++) {
    const node = queue[head];
    const gw = gatewayEntry.get(node);
    if (gw !== undefined) {
      const chain: string[] = [];
      for (let at: number = node; at !== -1; at = prev[at]) chain.push(net.satIds[at]);
      chain.reverse();
      const path = [clientId, ...chain, gw];
      return { path, hops: path.length - 1, reason: null, visible: true };
    }
    for (const next of net.islAdjacency[node]) {
      if (seen[next] || !allowed(next)) continue;
      seen[next] = 1;
      prev[next] = node;
      queue.push(next);
    }
  }

  // Маршрута нет — определяем, на каком слое он обрывается.
  const anyGatewayContact = gatewayIds.some((gw) => (net.groundLinks.get(gw) ?? []).length > 0);
  if (onlineGateways.length === 0) {
    return {
      path: [],
      hops: null,
      reason: anyGatewayContact ? 'gateway_unavailable' : 'no_gateway_contact',
      visible: true,
    };
  }
  const onlineContact = onlineGateways.some((gw) => (net.groundLinks.get(gw) ?? []).length > 0);
  if (!onlineContact) {
    return { path: [], hops: null, reason: 'no_gateway_contact', visible: true };
  }
  // Шлюз доступен и кем-то виден, но не тем сегментом сети, где находится клиент.
  return { path: [], hops: null, reason: 'isl_network_split', visible: true };
}

/** Координаты узла сети — аппарата или наземного пункта, км. */
export function nodePosition(net: NetworkState, id: string): [number, number, number] | null {
  const ground = net.groundXYZ.get(id);
  if (ground) return ground;
  const k = net.satIndex.get(id);
  if (k === undefined) return null;
  return [net.xyz[k * 3], net.xyz[k * 3 + 1], net.xyz[k * 3 + 2]];
}

/** Суммарная длина маршрута по прямым отрезкам между узлами, км. */
export function pathLengthKm(net: NetworkState, path: string[]): number {
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = nodePosition(net, path[i]);
    const b = nodePosition(net, path[i + 1]);
    if (!a || !b) continue;
    total += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  return total;
}

/**
 * Есть ли резервный путь, не использующий ни одного спутника основного маршрута.
 * Такой путь переживает отказ любого аппарата основного маршрута.
 */
export function hasSatelliteDisjointBackup(
  net: NetworkState,
  primary: string[],
  clientId: string,
  gatewayIds: string[],
): boolean {
  const excluded = new Set<number>();
  for (const id of primary.slice(1, -1)) {
    const k = net.satIndex.get(id);
    if (k !== undefined) excluded.add(k);
  }
  return findRoute(net, clientId, gatewayIds, excluded).path.length > 0;
}
