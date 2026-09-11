/**
 * Карта состояния сети: равнопромежуточная цилиндрическая проекция.
 *
 * Выбрана намеренно: инженер читает наземные трассы именно в этой проекции, а
 * подписи пунктов не наезжают друг на друга, как было бы на глобусе.
 */
import { useMemo } from 'react';
import { snapshot } from '../core/geometry';
import { PLANE_COLORS } from './Globe';
import type { Scenario } from '../core/types';

const W = 720;
const H = 360;

const INK = {
  canvas: '#0b0b0b',
  grid: '#1d1a18',
  gridStrong: '#2a2624',
  link: '#3d3a39',
  route: '#ee6018',
  satOff: '#4d4947',
  gateway: '#eeeeee',
  client: '#a0ca92',
  label: '#b8b3b0',
  selected: '#fafafa',
};

interface Props {
  scenario: Scenario;
  t_s: number;
  routePath: string[];
  selectedClient: string;
  selectedSatellite?: string | null;
  onSelectSatellite?: (id: string) => void;
  onSelectSite?: (id: string) => void;
}

function toXY(x: number, y: number, z: number): [number, number] {
  const r = Math.sqrt(x * x + y * y + z * z);
  const lat = Math.asin(z / r) * (180 / Math.PI);
  const lon = Math.atan2(y, x) * (180 / Math.PI);
  return [((lon + 180) / 360) * W, ((90 - lat) / 180) * H];
}

/** Отрезок, пересекающий край карты, рисуется двумя частями. */
function pieces(a: [number, number], b: [number, number]): [number, number, number, number][] {
  const [x1, y1] = a;
  const [x2, y2] = b;
  if (Math.abs(x1 - x2) <= W / 2) return [[x1, y1, x2, y2]];
  const shift = x1 < x2 ? -W : W;
  return [
    [x1, y1, x2 + shift, y2],
    [x1 - shift, y1, x2, y2],
  ];
}

export default function MapView({
  scenario,
  t_s,
  routePath,
  selectedClient,
  selectedSatellite = null,
  onSelectSatellite,
  onSelectSite,
}: Props) {
  const snap = useMemo(() => snapshot(scenario, t_s), [scenario, t_s]);

  const pos = useMemo(() => {
    const map = new Map<string, [number, number]>();
    for (const s of snap.satellites) map.set(s.id, toXY(s.x_km, s.y_km, s.z_km));
    for (const g of scenario.ground_sites) {
      map.set(g.id, [((g.lon_deg + 180) / 360) * W, ((90 - g.lat_deg) / 180) * H]);
    }
    return map;
  }, [snap, scenario.ground_sites]);

  const routeSet = useMemo(() => new Set(routePath), [routePath]);
  const routeEdges = useMemo(
    () => routePath.slice(0, -1).map((id, i) => [id, routePath[i + 1]] as const),
    [routePath],
  );
  const planeOf = useMemo(
    () => new Map(scenario.design.satellites.map((s) => [s.id, s.plane_id])),
    [scenario.design.satellites],
  );
  const planeColor = useMemo(
    () => new Map(scenario.design.planes.map((p, i) => [p.id, PLANE_COLORS[i % PLANE_COLORS.length]])),
    [scenario.design.planes],
  );
  const clickable = onSelectSatellite ? { cursor: 'pointer' } : undefined;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '100%', display: 'block' }}>
      <rect width={W} height={H} fill={INK.canvas} />

      {/* Сетка координат */}
      {[-60, -30, 0, 30, 60].map((lat) => (
        <line
          key={`la${lat}`}
          x1={0}
          x2={W}
          y1={((90 - lat) / 180) * H}
          y2={((90 - lat) / 180) * H}
          stroke={lat === 0 ? INK.gridStrong : INK.grid}
        />
      ))}
      {[-120, -60, 0, 60, 120].map((lon) => (
        <line
          key={`lo${lon}`}
          y1={0}
          y2={H}
          x1={((lon + 180) / 360) * W}
          x2={((lon + 180) / 360) * W}
          stroke={INK.grid}
        />
      ))}
      {/* Полярный круг — район обслуживания по условию кейса */}
      <line
        x1={0}
        x2={W}
        y1={((90 - 66.56) / 180) * H}
        y2={((90 - 66.56) / 180) * H}
        stroke={INK.link}
        strokeDasharray="3 5"
      />

      {/* Межспутниковые и наземные связи */}
      <g stroke={INK.link} strokeWidth={0.5}>
        {snap.edges.map(([a, b], i) => {
          const pa = pos.get(a);
          const pb = pos.get(b);
          if (!pa || !pb) return null;
          return pieces(pa, pb).map(([x1, y1, x2, y2], k) => (
            <line key={`${i}-${k}`} x1={x1} y1={y1} x2={x2} y2={y2} />
          ));
        })}
      </g>

      {/* Выбранный маршрут */}
      <g stroke={INK.route} strokeWidth={1.6} strokeLinecap="round">
        {routeEdges.map(([a, b], i) => {
          const pa = pos.get(a);
          const pb = pos.get(b);
          if (!pa || !pb) return null;
          return pieces(pa, pb).map(([x1, y1, x2, y2], k) => (
            <line key={`r${i}-${k}`} x1={x1} y1={y1} x2={x2} y2={y2} />
          ));
        })}
      </g>

      {/* Аппараты */}
      {snap.satellites.map((s) => {
        const [x, y] = pos.get(s.id)!;
        const onRoute = routeSet.has(s.id);
        const selected = s.id === selectedSatellite;
        return (
          <g key={s.id}>
            {selected && <circle cx={x} cy={y} r={6.5} fill="none" stroke={INK.selected} strokeWidth={1} />}
            <circle
              cx={x}
              cy={y}
              r={onRoute ? 3.6 : 2.2}
              fill={s.active ? planeColor.get(planeOf.get(s.id)!) ?? INK.gateway : INK.satOff}
              stroke={onRoute ? INK.route : 'none'}
              strokeWidth={1.4}
            />
            {(onRoute || selected) && (
              <text
                x={x + 7}
                y={y - 6}
                fill={selected ? INK.selected : INK.route}
                fontSize={8}
                fontFamily="Geist Mono, monospace"
              >
                {s.id}
              </text>
            )}
            {/* Невидимая область клика: точка слишком мала, чтобы попадать в неё мышью. */}
            <circle
              data-sat-id={s.id}
              cx={x}
              cy={y}
              r={6}
              fill="transparent"
              style={clickable}
              onClick={() => onSelectSatellite?.(s.id)}
            />
          </g>
        );
      })}

      {/* Наземные пункты */}
      {scenario.ground_sites.map((g) => {
        const [x, y] = pos.get(g.id)!;
        const isGw = g.role === 'gateway';
        const sel = g.id === selectedClient;
        return (
          <g
            key={g.id}
            data-site-id={g.id}
            style={onSelectSite ? { cursor: 'pointer' } : undefined}
            onClick={() => onSelectSite?.(g.id)}
          >
            {isGw ? (
              <rect x={x - 3.5} y={y - 3.5} width={7} height={7} fill={INK.gateway} />
            ) : (
              <circle cx={x} cy={y} r={3.5} fill={sel ? INK.route : INK.client} />
            )}
            <text x={x + 7} y={y + 3} fill={INK.label} fontSize={8.5} fontFamily="Geist Mono, monospace">
              {g.id}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
