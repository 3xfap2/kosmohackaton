/** Структуры сценария cosmo-A-1.0 — см. «Описание данных». */

export interface Environment {
  altitude_km: number;
  inclination_deg: number;
  earth_angle0_deg: number;
  horizon_s: number;
  step_s: number;
  min_elevation_deg: number;
  isl_range_km: number;
  target_availability: number;
}

export interface Plane {
  id: string;
  raan_deg: number;
  phase_deg: number;
}

export interface Satellite {
  id: string;
  plane_id: string;
  slot_deg: number;
  launch_batch: 1 | 2 | 3;
}

export interface Design {
  planes: Plane[];
  satellites: Satellite[];
  launch_stage: 1 | 2 | 3;
}

export type GroundRole = 'client' | 'gateway';

export interface GroundSite {
  id: string;
  name: string;
  role: GroundRole;
  lat_deg: number;
  lon_deg: number;
}

export interface Failure {
  satellite_id: string;
  start_s: number;
  end_s: number;
}

export interface GatewayOutage {
  gateway_id: string;
  start_s: number;
  end_s: number;
}

export interface Scenario {
  schema_version: string;
  meta: { id: string; title: string };
  environment: Environment;
  design: Design;
  ground_sites: GroundSite[];
  failures: Failure[];
  gateway_outages: GatewayOutage[];
}

/** Ребро сети: [id_1, id_2, distance_km]. Порядок совпадает с geometry.py. */
export type Edge = [string, string, number];

export interface SatelliteState {
  id: string;
  x_km: number;
  y_km: number;
  z_km: number;
  active: boolean;
}

export interface Snapshot {
  t_s: number;
  satellites: SatelliteState[];
  edges: Edge[];
  /** Углы возвышения только по активным аппаратам — как в geometry.py. */
  elevation_deg: Record<string, Record<string, number>>;
}
