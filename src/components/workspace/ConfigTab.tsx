/** Вкладка «Конфигурация»: очередь запуска, плоскости, отказы, условия расчёта. */
import FailureForm from './FailureForm';
import GatewayOutageForm from './GatewayOutageForm';
import { clock, formatDuration, pct } from './format';
import type { Failure, GatewayOutage, Scenario } from '../../core/types';

interface Props {
  scenario: Scenario;
  t: number;
  onChange: (scenario: Scenario) => void;
  onAddFailure: (failure: Failure) => void;
  onRemoveFailure: (index: number) => void;
  onAddGatewayOutage: (outage: GatewayOutage) => void;
  onRemoveGatewayOutage: (index: number) => void;
}

const norm360 = (a: number): number => ((a % 360) + 360) % 360;

/** Типовые площадки: рельеф и застройка поднимают эффективный порог видимости. */
const HORIZON_MASKS = [
  { value: '', label: 'как в сценарии' },
  { value: '5', label: 'открытое поле, 5°' },
  { value: '10', label: 'холмистая местность, 10°' },
  { value: '15', label: 'городская застройка, 15°' },
  { value: '20', label: 'плотная застройка, 20°' },
];

export default function ConfigTab({
  scenario,
  t,
  onChange,
  onAddFailure,
  onRemoveFailure,
  onAddGatewayOutage,
  onRemoveGatewayOutage,
}: Props) {
  const { design, environment: env } = scenario;

  const patchPlane = (id: string, field: 'raan_deg' | 'phase_deg', value: number) => {
    if (!Number.isFinite(value)) return;
    onChange({
      ...scenario,
      design: {
        ...design,
        planes: design.planes.map((p) => (p.id === id ? { ...p, [field]: norm360(value) } : p)),
      },
    });
  };

  const setSiteMask = (id: string, value: string) => {
    onChange({
      ...scenario,
      ground_sites: scenario.ground_sites.map((g) => {
        if (g.id !== id) return g;
        const next = { ...g };
        if (value === '') delete next.min_elevation_deg;
        else next.min_elevation_deg = Number(value);
        return next;
      }),
    });
  };

  return (
    <>
      <h4 className="sect mono">Этап развёртывания</h4>
      <div className="field">
        <span>Запущено очередей</span>
        <select
          aria-label="Этап развёртывания"
          value={design.launch_stage}
          onChange={(e) =>
            onChange({
              ...scenario,
              design: { ...design, launch_stage: Number(e.target.value) as 1 | 2 | 3 },
            })
          }
        >
          <option value={1}>1 — до 16</option>
          <option value={2}>2 — до 32</option>
          <option value={3}>3 — все 48</option>
        </select>
      </div>
      <div className="note">
        Состав очередей задан кейсом и не меняется — меняется только то, сколько из них уже
        выведено. В этом наборе очередь совпадает с орбитальной плоскостью целиком.
      </div>

      <h4 className="sect mono">Орбитальные плоскости</h4>
      {design.planes.map((plane) => {
        const total = design.satellites.filter((s) => s.plane_id === plane.id).length;
        const active = design.satellites.filter(
          (s) => s.plane_id === plane.id && s.launch_batch <= design.launch_stage,
        ).length;
        return (
          <div key={plane.id} style={{ marginTop: 14 }}>
            <div className="mono" style={{ marginBottom: 8, color: 'var(--stone)' }}>
              {`${plane.id} · ${active} из ${total} аппаратов`}
            </div>
            <div className="field">
              <span>RAAN, °</span>
              <input
                type="number"
                aria-label={`RAAN плоскости ${plane.id}, °`}
                step={5}
                value={plane.raan_deg}
                onChange={(e) => patchPlane(plane.id, 'raan_deg', Number(e.target.value))}
              />
            </div>
            <div className="field">
              <span>Фазирование, °</span>
              <input
                type="number"
                aria-label={`Фаза плоскости ${plane.id}, °`}
                step={2.5}
                value={plane.phase_deg}
                onChange={(e) => patchPlane(plane.id, 'phase_deg', Number(e.target.value))}
              />
            </div>
          </div>
        );
      })}

      <h4 className="sect mono">Периоды недоступности аппаратов</h4>
      {scenario.failures.length === 0 ? (
        <div className="note">Отказов не задано.</div>
      ) : (
        <div className="list">
          {scenario.failures.map((f, index) => (
            <div className="list-row" key={`${f.satellite_id}-${f.start_s}-${f.end_s}`}>
              <span className="mono">{f.satellite_id}</span>
              <span className="note">{`${clock(f.start_s)}–${clock(f.end_s)}`}</span>
              <button className="btn btn-bare btn-sm" onClick={() => onRemoveFailure(index)}>
                Убрать
              </button>
            </div>
          ))}
        </div>
      )}
      <div style={{ marginTop: 12 }}>
        <FailureForm scenario={scenario} defaultStart={t} onAdd={onAddFailure} />
      </div>

      <h4 className="sect mono">Недоступность шлюза</h4>
      {scenario.gateway_outages.length === 0 ? (
        <div className="note">
          Периодов не задано. Пока шлюз доступен, причина разрыва «шлюз недоступен» возникнуть не
          может — задайте период, чтобы её увидеть.
        </div>
      ) : (
        <div className="list">
          {scenario.gateway_outages.map((o, index) => (
            <div className="list-row" key={`${o.gateway_id}-${o.start_s}-${o.end_s}`}>
              <span className="mono">{o.gateway_id}</span>
              <span className="note">{`${clock(o.start_s)}–${clock(o.end_s)}`}</span>
              <button className="btn btn-bare btn-sm" onClick={() => onRemoveGatewayOutage(index)}>
                Убрать
              </button>
            </div>
          ))}
        </div>
      )}
      <div style={{ marginTop: 12 }}>
        <GatewayOutageForm scenario={scenario} defaultStart={t} onAdd={onAddGatewayOutage} />
      </div>

      <h4 className="sect mono">Маска горизонта площадок</h4>
      <div className="note" style={{ marginBottom: 10 }}>
        {`Рельеф и застройка вокруг пункта поднимают эффективный порог видимости. Это расширение поверх модели кейса: по умолчанию для всех действует общий порог ${env.min_elevation_deg}°.`}
      </div>
      {scenario.ground_sites.map((site) => (
        <div className="field" key={site.id}>
          <span>{`${site.id}${site.role === 'gateway' ? ' · шлюз' : ''}`}</span>
          <select
            aria-label={`Маска горизонта ${site.id}`}
            value={String(site.min_elevation_deg ?? '')}
            onChange={(e) => setSiteMask(site.id, e.target.value)}
          >
            {HORIZON_MASKS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      ))}

      <h4 className="sect mono">Условия расчёта</h4>
      <dl className="kv">
        <dt>Высота орбиты</dt>
        <dd>{`${env.altitude_km} км`}</dd>
        <dt>Наклонение</dt>
        <dd>{`${env.inclination_deg}°`}</dd>
        <dt>Начальный угол Земли</dt>
        <dd>{`${env.earth_angle0_deg}°`}</dd>
        <dt>Горизонт расчёта</dt>
        <dd>{`${env.horizon_s} с · ${formatDuration(env.horizon_s)}`}</dd>
        <dt>Шаг</dt>
        <dd>{`${env.step_s} с · ${env.horizon_s / env.step_s} отсчётов`}</dd>
        <dt>Порог угла возвышения</dt>
        <dd>{`${env.min_elevation_deg}°`}</dd>
        <dt>Дальность ISL</dt>
        <dd>{`${env.isl_range_km} км`}</dd>
        <dt>Целевая доступность</dt>
        <dd>{pct(env.target_availability)}</dd>
      </dl>
      <div className="note" style={{ marginTop: 8 }}>
        Условия берутся из файла и не правятся в интерфейсе: варианты сравниваются на одной сетке
        времени и одних параметрах связи. Другие значения — отдельный запуск с новым файлом.
      </div>

      <h4 className="sect mono">Наземные пункты</h4>
      <table className="data compact">
        <thead>
          <tr>
            <th>Пункт</th>
            <th>Роль</th>
            <th>Широта</th>
            <th>Долгота</th>
          </tr>
        </thead>
        <tbody>
          {scenario.ground_sites.map((g) => (
            <tr key={g.id}>
              <td>{g.id}</td>
              <td>{g.role === 'gateway' ? 'шлюз' : 'клиент'}</td>
              <td>{`${g.lat_deg}°`}</td>
              <td>{`${g.lon_deg}°`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
