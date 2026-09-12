/** Вкладка «Сеть»: показатели, текущий маршрут, видимые аппараты, карточка аппарата. */
import { Fragment } from 'react';
import FailureForm from './FailureForm';
import { REASON_COLOR } from '../AvailabilityStrip';
import { BREAK_REASON_RU } from '../../core/routing';
import { clock, formatDuration, num, pct } from './format';
import type { SimulationResult } from '../../core/simulate';
import type { Failure, Scenario, Snapshot } from '../../core/types';

interface Props {
  scenario: Scenario;
  sim: SimulationResult;
  snap: Snapshot;
  cursor: number;
  client: string;
  onClient: (id: string) => void;
  selectedSat: string | null;
  onSelectSat: (id: string | null) => void;
  onAddFailure: (failure: Failure) => void;
  onRemoveFailure: (index: number) => void;
}

export default function NetworkTab(p: Props) {
  const { scenario, sim, snap, cursor, client } = p;
  const t = sim.times[cursor];
  const step = sim.steps[client]?.[cursor];
  const metrics = sim.metrics.find((m) => m.client_id === client);
  const site = scenario.ground_sites.find((g) => g.id === client);
  const minElevation = site?.min_elevation_deg ?? scenario.environment.min_elevation_deg;
  const satIds = new Set(scenario.design.satellites.map((s) => s.id));
  const planeOf = new Map(scenario.design.satellites.map((s) => [s.id, s.plane_id]));
  const onRoute = new Set(step?.path ?? []);
  const visible = Object.entries(snap.elevation_deg[client] ?? {})
    .filter(([, el]) => el >= minElevation)
    .sort((a, b) => b[1] - a[1]);

  return (
    <>
      <h4 className="sect mono">Показатели по пунктам</h4>
      <table className="data">
        <thead>
          <tr>
            <th>Пункт</th>
            <th>Видим.</th>
            <th>Доступн.</th>
            <th>Перерыв</th>
          </tr>
        </thead>
        <tbody>
          {sim.metrics.map((m) => (
            <tr
              key={m.client_id}
              className={m.client_id === client ? 'sel' : ''}
              onClick={() => p.onClient(m.client_id)}
            >
              <td>{m.client_id}</td>
              <td>{pct(m.visibility)}</td>
              <td>
                <span className={`status ${m.meets_target ? 'ok' : 'bad'}`}>{pct(m.availability)}</span>
              </td>
              <td>{formatDuration(m.max_outage_s)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {metrics && (
        <>
          <h4 className="sect mono">{`${client} · подробно`}</h4>
          <dl className="kv">
            <dt>Перерывов за период</dt>
            <dd>{metrics.outage_count}</dd>
            <dt>Перерыв в начале периода</dt>
            <dd>{metrics.leading_outage_s > 0 ? formatDuration(metrics.leading_outage_s) : 'нет'}</dd>
            <dt>Перерыв в конце периода</dt>
            <dd>{metrics.trailing_outage_s > 0 ? formatDuration(metrics.trailing_outage_s) : 'нет'}</dd>
            <dt>Среднее число переходов</dt>
            <dd>{num(metrics.mean_hops, 2)}</dd>
            <dt>Средняя задержка</dt>
            <dd>{metrics.mean_latency_ms === null ? '—' : `${num(metrics.mean_latency_ms)} мс`}</dd>
            <dt>Смен маршрута без разрыва</dt>
            <dd>{metrics.route_changes}</dd>
            <dt>Маршрут держится в среднем</dt>
            <dd>
              {metrics.mean_route_lifetime_s === null
                ? '—'
                : formatDuration(metrics.mean_route_lifetime_s)}
            </dd>
            <dt>Есть резервный путь</dt>
            <dd>{pct(metrics.backup_share)}</dd>
          </dl>
        </>
      )}

      <h4 className="sect mono">{`Маршрут · ${clock(t)}`}</h4>
      <div className="route-box">
        {step && step.path.length > 0 ? (
          <>
            <div className="chain">
              {step.path.map((id, i) => (
                <Fragment key={id}>
                  {i > 0 && ' → '}
                  {satIds.has(id) ? (
                    <button className="chip" onClick={() => p.onSelectSat(id)}>
                      {id}
                    </button>
                  ) : (
                    <span>{id}</span>
                  )}
                </Fragment>
              ))}
            </div>
            <div className="note" style={{ marginTop: 6 }}>
              {`переходов: ${step.hops} · ${num(step.path_km, 0)} км · ${num(step.latency_ms, 2)} мс · резервный путь: ${
                step.has_backup === null ? '—' : step.has_backup ? 'есть' : 'нет'
              }`}
            </div>
          </>
        ) : (
          <>
            <span style={{ color: REASON_COLOR[step?.reason ?? 'no_visible_satellite'] }}>
              Маршрута нет
            </span>
            <div className="note" style={{ marginTop: 4 }}>
              {`Причина: ${step?.reason ? BREAK_REASON_RU[step.reason] : '—'}`}
            </div>
          </>
        )}
      </div>

      <h4 className="sect mono">{`Видимые из ${client} · выше ${minElevation}°`}</h4>
      {visible.length === 0 ? (
        <div className="note">Ни одного активного аппарата над горизонтом выше порога.</div>
      ) : (
        <div className="list">
          {visible.map(([id, el]) => (
            <div className="list-row" key={id}>
              <button className="chip" onClick={() => p.onSelectSat(id)}>
                {id}
              </button>
              <span className="note">
                {`${planeOf.get(id) ?? ''}${onRoute.has(id) ? ' · в маршруте' : ''}`}
              </span>
              <span className="note">{`${el.toFixed(1)}°`}</span>
            </div>
          ))}
        </div>
      )}

      {p.selectedSat && (
        <SatelliteCard
          id={p.selectedSat}
          scenario={scenario}
          snap={snap}
          t={t}
          client={client}
          onRoute={onRoute.has(p.selectedSat)}
          onClose={() => p.onSelectSat(null)}
          onAddFailure={p.onAddFailure}
          onRemoveFailure={p.onRemoveFailure}
        />
      )}
    </>
  );
}

interface CardProps {
  id: string;
  scenario: Scenario;
  snap: Snapshot;
  t: number;
  client: string;
  onRoute: boolean;
  onClose: () => void;
  onAddFailure: (failure: Failure) => void;
  onRemoveFailure: (index: number) => void;
}

/** Состояние конкретного аппарата — требование ТЗ «подписи позволяют определить аппарат и его состояние». */
function SatelliteCard({ id, scenario, snap, t, client, onRoute, onClose, onAddFailure, onRemoveFailure }: CardProps) {
  const sat = scenario.design.satellites.find((s) => s.id === id);
  if (!sat) return null;
  const plane = scenario.design.planes.find((pl) => pl.id === sat.plane_id);
  const stage = scenario.design.launch_stage;
  const own = scenario.failures
    .map((f, index) => ({ f, index }))
    .filter((x) => x.f.satellite_id === id);
  const current = own.find((x) => x.f.start_s <= t && t < x.f.end_s);
  const status = current
    ? { ok: false, text: `в отказе до ${clock(current.f.end_s)}` }
    : sat.launch_batch > stage
      ? { ok: false, text: `не запущен · очередь ${sat.launch_batch}, выбран этап ${stage}` }
      : { ok: true, text: 'активен' };

  const groundIds = new Set(scenario.ground_sites.map((g) => g.id));
  const links = snap.edges.filter((e) => e[0] === id || e[1] === id);
  const groundLinks = links.filter((e) => groundIds.has(e[0]) || groundIds.has(e[1])).length;
  const elevation = snap.elevation_deg[client]?.[id];

  return (
    <div className="card-block" data-testid="sat-card">
      <div className="head">
        <span className="mono" style={{ color: 'var(--bone)' }}>
          {id}
        </span>
        <button className="btn btn-bare btn-sm" onClick={onClose}>
          Закрыть
        </button>
      </div>
      <span className={`badge ${status.ok ? 'ok' : 'bad'}`}>{status.text}</span>

      <dl className="kv" style={{ marginTop: 14 }}>
        <dt>Плоскость</dt>
        <dd>{`${sat.plane_id}${plane ? ` · RAAN ${plane.raan_deg}°` : ''}`}</dd>
        <dt>Положение в плоскости</dt>
        <dd>{plane ? `${((sat.slot_deg + plane.phase_deg) % 360).toFixed(1)}°` : '—'}</dd>
        <dt>Очередь запуска</dt>
        <dd>{sat.launch_batch}</dd>
        <dt>Связей сейчас</dt>
        <dd>{`${links.length - groundLinks} ISL · ${groundLinks} наземных`}</dd>
        <dt>{`Угол возвышения из ${client}`}</dt>
        <dd>{elevation === undefined ? '—' : `${elevation.toFixed(1)}°`}</dd>
        <dt>В текущем маршруте</dt>
        <dd>{onRoute ? 'да' : 'нет'}</dd>
      </dl>

      {own.length > 0 && (
        <>
          <div className="mono note" style={{ margin: '14px 0 6px' }}>
            Периоды отказа
          </div>
          {own.map(({ f, index }) => (
            <div className="list-row" key={`${f.start_s}-${f.end_s}`}>
              <span>{`${clock(f.start_s)}–${clock(f.end_s)}`}</span>
              <span />
              <button className="btn btn-bare btn-sm" onClick={() => onRemoveFailure(index)}>
                Убрать
              </button>
            </div>
          ))}
        </>
      )}

      <div className="mono note" style={{ margin: '14px 0 6px' }}>
        Задать отказ
      </div>
      <FailureForm scenario={scenario} satelliteId={id} defaultStart={t} onAdd={onAddFailure} />
    </div>
  );
}
