/** Нижняя панель: воспроизведение, переход по перерывам, диаграммы доступности. */
import AvailabilityStrip, { REASON_COLOR, ROUTE_OK } from '../AvailabilityStrip';
import { nextOutage } from '../../core/analysis';
import { BREAK_REASON_RU } from '../../core/routing';
import { clock } from './format';
import type { SimulationResult } from '../../core/simulate';

interface Props {
  sim: SimulationResult;
  cursor: number;
  onCursor: (index: number) => void;
  client: string;
  onClient: (id: string) => void;
  playing: boolean;
  onPlaying: (on: boolean) => void;
}

export default function TimelineBar(p: Props) {
  const last = p.sim.times.length - 1;
  const steps = p.sim.steps[p.client] ?? [];
  const prev = steps.length > 0 ? nextOutage(steps, p.cursor, -1) : null;
  const next = steps.length > 0 ? nextOutage(steps, p.cursor, 1) : null;

  return (
    <div className="ws-bottom">
      <div className="timeline">
        <button
          className="btn btn-sm"
          onClick={() => p.onPlaying(!p.playing)}
          title={p.playing ? 'Пауза' : 'Воспроизвести сутки'}
        >
          {p.playing ? '❚❚' : '▶'}
        </button>
        <button
          className="btn btn-sm btn-bare"
          disabled={prev === null}
          onClick={() => prev !== null && p.onCursor(prev)}
          title={`Предыдущий перерыв у ${p.client}`}
        >
          ‹ Перерыв
        </button>
        <button className="btn btn-sm" onClick={() => p.onCursor(Math.max(0, p.cursor - 1))}>
          ←
        </button>
        <input
          type="range"
          aria-label="Момент расчёта"
          min={0}
          max={last}
          value={p.cursor}
          onChange={(e) => p.onCursor(Number(e.target.value))}
        />
        <button className="btn btn-sm" onClick={() => p.onCursor(Math.min(last, p.cursor + 1))}>
          →
        </button>
        <button
          className="btn btn-sm btn-bare"
          disabled={next === null}
          onClick={() => next !== null && p.onCursor(next)}
          title={`Следующий перерыв у ${p.client}`}
        >
          Перерыв ›
        </button>
        <span className="clock">
          {`${clock(p.sim.times[p.cursor] ?? 0)} · шаг ${p.cursor + 1} из ${p.sim.times.length}`}
        </span>
      </div>

      <div className="rows">
        {p.sim.metrics.map((m) => (
          <div className="row" key={m.client_id}>
            <span
              className={`name ${m.client_id === p.client ? 'sel' : ''}`}
              onClick={() => p.onClient(m.client_id)}
            >
              {m.client_id}
            </span>
            <AvailabilityStrip
              steps={p.sim.steps[m.client_id]}
              cursor={p.cursor}
              onSeek={p.onCursor}
            />
          </div>
        ))}
      </div>

      <div className="legend">
        <span>
          <i style={{ background: ROUTE_OK }} />
          маршрут есть
        </span>
        {Object.entries(REASON_COLOR).map(([key, color]) => (
          <span key={key}>
            <i style={{ background: color }} />
            {BREAK_REASON_RU[key as keyof typeof BREAK_REASON_RU]}
          </span>
        ))}
      </div>
    </div>
  );
}
