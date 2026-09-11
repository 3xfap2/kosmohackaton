/** Вкладка «Сравнение»: варианты, рекомендация и подбор ориентации плоскостей. */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { simulate } from '../../core/simulate';
import {
  applyPattern,
  recommend,
  sweepPatterns,
  SWEEP_PHASES,
  SWEEP_SPACINGS,
  type Candidate,
  type SweepResult,
} from '../../core/analysis';
import { diffScenarios, isReference, type Variant } from '../../core/variants';
import { formatDuration, num, pct } from './format';
import type { SimulationResult } from '../../core/simulate';
import type { Scenario } from '../../core/types';

interface Props {
  scenario: Scenario;
  sim: SimulationResult;
  /** Эталонные варианты кейса и сохранённые пользователем. */
  variants: Variant[];
  /** Сохранять свои варианты можно только с профилем. */
  canSave: boolean;
  onSave: (name: string) => void;
  onOpen: (variant: Variant) => void;
  onRemove: (id: string) => void;
  onApply: (scenario: Scenario) => void;
}

const CURRENT = 'current';

const norm360 = (a: number): number => ((a % 360) + 360) % 360;

/** Ключ условий: подбор устаревает, если поменялось что-то кроме плоскостей. */
const conditionsKey = (s: Scenario): string =>
  JSON.stringify({ ...s, design: { ...s.design, planes: [] } });

/** Схема текущей конфигурации, если плоскости расставлены равномерно. */
function currentPattern(s: Scenario): { spacing: number; phase: number } | null {
  const planes = s.design.planes;
  if (planes.length < 2) return null;
  const spacing = norm360(planes[1].raan_deg - planes[0].raan_deg);
  const phase = norm360(planes[1].phase_deg - planes[0].phase_deg);
  const close = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  const uniform = planes.every(
    (p, k) =>
      close(norm360(p.raan_deg - planes[0].raan_deg), norm360(k * spacing)) &&
      close(norm360(p.phase_deg - planes[0].phase_deg), norm360(k * phase)),
  );
  return uniform ? { spacing, phase } : null;
}

/** Заливка ячейки: от тёмного к зелёному по средней доступности. */
const mix = (t: number): string => {
  const from = [29, 26, 24];
  const to = [160, 202, 146];
  const k = Math.max(0, Math.min(1, t));
  const c = from.map((v, i) => Math.round(v + (to[i] - v) * k));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
};

export default function CompareTab(p: Props) {
  const [name, setName] = useState('');
  const [sweep, setSweep] = useState<{ result: SweepResult; key: string } | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  const variantSims = useMemo(
    () => p.variants.map((v) => ({ id: v.id, name: v.name, sim: simulate(v.scenario, { backup: false }) })),
    [p.variants],
  );
  const candidates: Candidate[] = useMemo(
    () => [{ id: CURRENT, name: 'Текущая конфигурация', sim: p.sim }, ...variantSims],
    [p.sim, variantSims],
  );
  const rec = useMemo(() => (candidates.length > 1 ? recommend(candidates) : null), [candidates]);
  const clients = p.sim.metrics.map((m) => m.client_id);
  const variantById = new Map(p.variants.map((v) => [v.id, v]));
  const rows = rec ? rec.ranking.map((r) => r.candidate) : candidates;
  const hasReferences = p.variants.some((v) => isReference(v.id));

  const runSweep = async () => {
    const key = conditionsKey(p.scenario);
    setProgress(0);
    const result = await sweepPatterns(
      p.scenario,
      SWEEP_SPACINGS,
      SWEEP_PHASES,
      (done, total) => setProgress(done / total),
      () => cancelled.current,
    );
    setProgress(null);
    if (result) setSweep({ result, key });
  };

  const meanOf = (values: Array<number | null>): number | null => {
    const list = values.filter((v): v is number => v !== null);
    return list.length > 0 ? list.reduce((a, b) => a + b, 0) / list.length : null;
  };

  return (
    <>
      <h4 className="sect mono">Сохранить вариант</h4>
      {p.canSave ? (
        <>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              placeholder="Название варианта"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button
              className="btn btn-sm"
              onClick={() => {
                p.onSave(name);
                setName('');
              }}
            >
              Сохранить
            </button>
          </div>
          <div className="note" style={{ marginTop: 8 }}>
            Сохраняется весь сценарий: этап, плоскости, отказы. Варианты считаются на одной сетке
            времени и по одним правилам.
          </div>
        </>
      ) : (
        <div className="note">
          Свои варианты сохраняются в профиле. Он локальный: создаётся мгновенно, без
          подтверждения почты и без отправки данных куда-либо.
          <div style={{ marginTop: 10 }}>
            <Link className="btn btn-sm" to="/auth">
              Войти или создать профиль
            </Link>
          </div>
        </div>
      )}

      {rec ? (
        <div className="rec" data-testid="recommendation">
          <div className="mono" style={{ color: 'var(--metric)' }}>
            Рекомендация
          </div>
          <div className="name">{rec.best.candidate.name}</div>
          <ul>
            {rec.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          {rec.conditions_differ.length > 0 && (
            <div className="warn">
              {`Условия расчёта различаются: ${rec.conditions_differ.join('; ')}. Сравнение корректно только с этой оговоркой.`}
            </div>
          )}
          {rec.best.candidate.id !== CURRENT && (
            <button
              className="btn btn-sm"
              style={{ marginTop: 10 }}
              onClick={() => {
                const v = variantById.get(rec.best.candidate.id);
                if (v) p.onOpen(v);
              }}
            >
              Открыть рекомендованный
            </button>
          )}
          <div className="note" style={{ marginTop: 8 }}>
            Ключевой показатель — средняя доступность по пунктам; при равенстве решает худший
            пункт, затем самый длинный перерыв.
          </div>
        </div>
      ) : (
        <div className="note" style={{ margin: '18px 0' }}>
          Сохраните хотя бы один вариант — появятся сравнение и рекомендация.
        </div>
      )}

      <h4 className="sect mono">Сравнение вариантов</h4>
      <div className="scroll-x">
        <table className="data compact" data-testid="compare-table">
          <thead>
            <tr>
              <th>Вариант</th>
              {clients.map((c) => (
                <th key={c}>{c}</th>
              ))}
              <th>Средняя</th>
              <th>Перерыв</th>
              <th>Хопы</th>
              <th>Задержка</th>
              <th>Смен</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const byClient = new Map(c.sim.metrics.map((m) => [m.client_id, m]));
              const worst = Math.max(0, ...c.sim.metrics.map((m) => m.max_outage_s));
              const hops = meanOf(c.sim.metrics.map((m) => m.mean_hops));
              const latency = meanOf(c.sim.metrics.map((m) => m.mean_latency_ms));
              const changes = c.sim.metrics.reduce((a, m) => a + m.route_changes, 0);
              const variant = variantById.get(c.id);
              const diff = variant ? diffScenarios(p.scenario, variant.scenario) : [];
              return (
                <Fragment key={c.id}>
                  <tr className={rec && rec.best.candidate.id === c.id ? 'best' : ''}>
                    <td>{c.name}</td>
                    {clients.map((cl) => {
                      const m = byClient.get(cl);
                      return (
                        <td key={cl}>
                          {m ? (
                            <span className={`status ${m.meets_target ? 'ok' : 'bad'}`}>
                              {pct(m.availability)}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                      );
                    })}
                    <td>{pct(c.sim.mean_availability)}</td>
                    <td>{formatDuration(worst)}</td>
                    <td>{num(hops, 2)}</td>
                    <td>{latency === null ? '—' : `${num(latency)} мс`}</td>
                    <td>{changes}</td>
                    <td>
                      {variant && (
                        <>
                          <button className="btn btn-bare btn-sm" onClick={() => p.onOpen(variant)}>
                            Открыть
                          </button>
                          {!isReference(variant.id) && (
                            <button
                              className="btn btn-bare btn-sm"
                              title="Удалить вариант"
                              onClick={() => p.onRemove(variant.id)}
                            >
                              ✕
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                  {diff.length > 0 && (
                    <tr className="diff-line">
                      <td colSpan={clients.length + 7}>
                        {`относительно текущей: ${diff.join(', ')}`}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {hasReferences && (
        <div className="note" style={{ marginTop: 8 }}>
          Эталонные варианты — три обязательных расчёта из ТЗ: полная группировка, первая очередь
          и сценарий отказов. Доступны без входа и показываются, когда состав наземных пунктов
          совпадает с текущим сценарием.
        </div>
      )}

      <h4 className="sect mono">Подбор ориентации плоскостей</h4>
      <div className="note">
        {`Перебор равномерных схем: шаг RAAN между плоскостями ${SWEEP_SPACINGS[0]}–${SWEEP_SPACINGS[SWEEP_SPACINGS.length - 1]}°, сдвиг фазы 0–${SWEEP_PHASES[SWEEP_PHASES.length - 1]}°. Состав очередей не меняется. Всего ${SWEEP_SPACINGS.length * SWEEP_PHASES.length} прогонов.`}
      </div>
      <button
        className="btn btn-sm"
        style={{ marginTop: 10 }}
        disabled={progress !== null}
        onClick={runSweep}
      >
        {progress === null ? 'Подобрать' : 'Считаю…'}
      </button>
      {progress !== null && (
        <div className="progress">
          <i style={{ width: `${progress * 100}%` }} />
        </div>
      )}

      {sweep && (
        <SweepGrid
          sweep={sweep.result}
          stale={sweep.key !== conditionsKey(p.scenario)}
          current={currentPattern(p.scenario)}
          onApply={(spacing, phase) => p.onApply(applyPattern(p.scenario, spacing, phase))}
        />
      )}
    </>
  );
}

interface GridProps {
  sweep: SweepResult;
  stale: boolean;
  current: { spacing: number; phase: number } | null;
  onApply: (spacing: number, phase: number) => void;
}

function SweepGrid({ sweep, stale, current, onApply }: GridProps) {
  const means = sweep.cells.map((c) => c.mean);
  const lo = Math.min(...means);
  const hi = Math.max(...means);

  return (
    <div style={{ marginTop: 14 }}>
      <div className="scroll-x">
        <table className="heat">
          <thead>
            <tr>
              <th>фаза / RAAN</th>
              {sweep.spacings.map((s) => (
                <th key={s}>{`${s}°`}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sweep.phases.map((phase) => (
              <tr key={phase}>
                <th>{`${phase}°`}</th>
                {sweep.spacings.map((spacing) => {
                  const cell = sweep.cells.find(
                    (c) => c.raan_spacing === spacing && c.phase_step === phase,
                  )!;
                  const t = hi > lo ? (cell.mean - lo) / (hi - lo) : 1;
                  const isBest =
                    cell.raan_spacing === sweep.best.raan_spacing &&
                    cell.phase_step === sweep.best.phase_step;
                  const isCurrent =
                    current !== null &&
                    Math.abs(current.spacing - spacing) < 1e-6 &&
                    Math.abs(current.phase - phase) < 1e-6;
                  return (
                    <td
                      key={spacing}
                      className={`${isBest ? 'best' : ''} ${isCurrent ? 'current' : ''}`}
                      style={{ background: mix(t), color: t > 0.55 ? '#101010' : '#b8b3b0' }}
                      title={`шаг RAAN ${spacing}°, сдвиг фазы ${phase}°: средняя ${pct(cell.mean)}, худший пункт ${pct(cell.min)}`}
                      onClick={() => onApply(spacing, phase)}
                    >
                      {(cell.mean * 100).toFixed(1)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="note" style={{ marginTop: 8 }}>
        {`Лучшее: шаг ${sweep.best.raan_spacing}°, сдвиг ${sweep.best.phase_step}° — средняя ${pct(sweep.best.mean)}, худший пункт ${pct(sweep.best.min)}${sweep.best.meets_all ? ', цель достигнута всеми пунктами' : ''}. Белая рамка — лучшее, оранжевая — текущая конфигурация. Клик по ячейке применяет схему.`}
      </div>
      {stale && (
        <div className="warn">
          Подбор делался для другой конфигурации — этап, отказы или условия изменились. Запустите
          заново.
        </div>
      )}
    </div>
  );
}
