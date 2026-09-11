/**
 * Порт расчётного модуля geometry.py на TypeScript.
 *
 * Порядок арифметических операций намеренно повторяет оригинал: ядро сверяется
 * с эталонными снапшотами Python побитово (см. tests/geometry.parity.test.ts).
 */
import type { Edge, Scenario, Snapshot, GroundSite } from './types';

export const R_EARTH_KM = 6371.0;
export const MU_KM3_S2 = 398600.435507;
export const EARTH_PERIOD_S = 86164.09054;

const OMEGA = (2 * Math.PI) / EARTH_PERIOD_S;
const DEG = Math.PI / 180;

/** Позиции аппаратов в системе координат, связанной с Землёй: [x0,y0,z0, x1,y1,z1, ...]. */
export interface Positions {
  ids: string[];
  xyz: Float64Array;
}

export function positions(scenario: Scenario, t_s: number): Positions {
  const { environment: e, design: d } = scenario;
  const planes = new Map(d.planes.map((p) => [p.id, p]));
  const r = R_EARTH_KM + e.altitude_km;
  const n = Math.sqrt(MU_KM3_S2 / (r * r * r));
  const cosInc = Math.cos(e.inclination_deg * DEG);
  const sinInc = Math.sin(e.inclination_deg * DEG);

  const th = e.earth_angle0_deg * DEG + OMEGA * t_s;
  const cosTh = Math.cos(th);
  const sinTh = Math.sin(th);

  const ids: string[] = new Array(d.satellites.length);
  const xyz = new Float64Array(d.satellites.length * 3);

  for (let k = 0; k < d.satellites.length; k++) {
    const sat = d.satellites[k];
    const plane = planes.get(sat.plane_id);
    if (!plane) throw new Error(`Спутник ${sat.id} ссылается на неизвестную плоскость ${sat.plane_id}`);

    const u = (sat.slot_deg + plane.phase_deg) * DEG + n * t_s;
    const om = plane.raan_deg * DEG;
    const cu = Math.cos(u);
    const su = Math.sin(u);
    const co = Math.cos(om);
    const so = Math.sin(om);

    // Инерциальные координаты, затем поворот в систему, связанную с Землёй.
    const x = r * (co * cu - so * su * cosInc);
    const y = r * (so * cu + co * su * cosInc);
    const z = r * (su * sinInc);

    ids[k] = sat.id;
    xyz[k * 3] = x * cosTh + y * sinTh;
    xyz[k * 3 + 1] = -(x * sinTh) + y * cosTh;
    xyz[k * 3 + 2] = z;
  }
  return { ids, xyz };
}

export function groundPosition(site: GroundSite): [number, number, number] {
  const lat = site.lat_deg * DEG;
  const lon = site.lon_deg * DEG;
  return [
    R_EARTH_KM * (Math.cos(lat) * Math.cos(lon)),
    R_EARTH_KM * (Math.cos(lat) * Math.sin(lon)),
    R_EARTH_KM * Math.sin(lat),
  ];
}

/**
 * Состав активных аппаратов на момент t: запущены по выбранной очереди и не
 * находятся в периоде недоступности. Интервал отказа — [start_s; end_s).
 */
export function activeMask(scenario: Scenario, t_s: number): Uint8Array {
  const { design: d } = scenario;
  const failed = new Set<string>();
  for (const f of scenario.failures) {
    if (f.start_s <= t_s && t_s < f.end_s) failed.add(f.satellite_id);
  }
  const mask = new Uint8Array(d.satellites.length);
  for (let k = 0; k < d.satellites.length; k++) {
    const sat = d.satellites[k];
    mask[k] = sat.launch_batch <= d.launch_stage && !failed.has(sat.id) ? 1 : 0;
  }
  return mask;
}

export function gatewayOffline(scenario: Scenario, gatewayId: string, t_s: number): boolean {
  return scenario.gateway_outages.some(
    (o) => o.gateway_id === gatewayId && o.start_s <= t_s && t_s < o.end_s,
  );
}

/**
 * Состояние сети на момент t: положения аппаратов, доступные связи и углы
 * возвышения. Рёбра двунаправленные; наземные узлы ретранслировать не могут —
 * это учитывается на уровне маршрутизации, а не здесь.
 */
export function snapshot(scenario: Scenario, t_s: number): Snapshot {
  const e = scenario.environment;
  const { ids, xyz } = positions(scenario, t_s);
  const active = activeMask(scenario, t_s);
  const count = ids.length;
  const edges: Edge[] = [];

  // Межспутниковые связи: в пределах дальности и без пересечения линии с Землёй.
  for (let i = 0; i < count; i++) {
    for (let j = i + 1; j < count; j++) {
      const dx = xyz[j * 3] - xyz[i * 3];
      const dy = xyz[j * 3 + 1] - xyz[i * 3 + 1];
      const dz = xyz[j * 3 + 2] - xyz[i * 3 + 2];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (!(dist < e.isl_range_km) || !active[i] || !active[j]) continue;

      const denom = Math.max(dx * dx + dy * dy + dz * dz, 1e-12);
      const dot = xyz[i * 3] * dx + xyz[i * 3 + 1] * dy + xyz[i * 3 + 2] * dz;
      const lam = Math.min(Math.max(-dot / denom, 0), 1);
      const px = xyz[i * 3] + lam * dx;
      const py = xyz[i * 3 + 1] + lam * dy;
      const pz = xyz[i * 3 + 2] + lam * dz;
      const closest = Math.sqrt(px * px + py * py + pz * pz);
      if (closest > R_EARTH_KM) edges.push([ids[i], ids[j], dist]);
    }
  }

  // Наземные линии: угол возвышения не ниже порога, аппарат активен, шлюз доступен.
  const elevation_deg: Record<string, Record<string, number>> = {};
  for (const site of scenario.ground_sites) {
    const [gx, gy, gz] = groundPosition(site);
    const ux = gx / R_EARTH_KM;
    const uy = gy / R_EARTH_KM;
    const uz = gz / R_EARTH_KM;
    const offline = gatewayOffline(scenario, site.id, t_s);
    const perSite: Record<string, number> = {};

    for (let k = 0; k < count; k++) {
      const dx = xyz[k * 3] - gx;
      const dy = xyz[k * 3 + 1] - gy;
      const dz = xyz[k * 3 + 2] - gz;
      const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const sin = Math.min(Math.max((dx * ux + dy * uy + dz * uz) / dl, -1), 1);
      const el = Math.asin(sin) / DEG;
      if (active[k]) perSite[ids[k]] = el;
      if (el >= e.min_elevation_deg && active[k] && !offline) edges.push([site.id, ids[k], dl]);
    }
    elevation_deg[site.id] = perSite;
  }

  return {
    t_s,
    satellites: ids.map((id, k) => ({
      id,
      x_km: xyz[k * 3],
      y_km: xyz[k * 3 + 1],
      z_km: xyz[k * 3 + 2],
      active: active[k] === 1,
    })),
    edges,
    elevation_deg,
  };
}
