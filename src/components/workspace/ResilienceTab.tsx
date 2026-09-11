/** Вкладка «Устойчивость»: зависимость от шлюза, стабильность маршрутов, уязвимые аппараты. */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  findVulnerableSatellites,
  gatewayDependency,
  satelliteUsage,
  type Vulnerability,
} from '../../core/analysis';
import { simulate } from '../../core/simulate';
import { formatDuration, num, pct } from './format';
import type { SimulationResult } from '../../core/simulate';
import type { Scenario } from '../../core/types';

interface Props {
  scenario: Scenario;
  sim: SimulationResult;
  onSelectSat: (id: string) => void;
  onJump: (index: number) => void;
}

export default function ResilienceTab(p: Props) {
  const dep = useMemo(() => gatewayDependency(p.sim), [p.sim]);
  const usage = useMemo(() => satelliteUsage(p.sim).slice(0, 10), [p.sim]);
  const [vulnerable, setVulnerable] = useState<{ list: Vulnerability[]; key: string } | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
    };
  }, []);

  const key = JSON.stringify(p.scenario);
  const maxUsage = Math.max(...usage.map((u) => u.share), 1e-9);

  const runVulnerable = async () => {
    setProgress(0);
    const baseline = simulate(p.scenario, { backup: false });
    const list = await findVulnerableSatellites(
      p.scenario,
      baseline,
      (done, total) => setProgress(done / total),
      () => cancelled.current,
    );
    setProgress(null);
    if (list) setVulnerable({ list, key });
  };

  return (
    <>
      <h4 className="sect mono">Зависимость от шлюза</h4>
      <dl className="kv" data-testid="gateway-dependency">
        <dt>Шлюз видит хотя бы один аппарат</dt>
        <dd>{pct(dep.contact_share)}</dd>
        <dt>Все пункты без связи одновременно из-за шлюза</dt>
        <dd>{`${dep.shared_blackout_steps} отсч. · ${formatDuration(dep.shared_blackout_s)}`}</dd>
        <dt>Доля всех перерывов из-за шлюза</dt>
        <dd>{pct(dep.gateway_share_of_outages)}</dd>
      </dl>

      <table className="data compact" style={{ marginTop: 12 }}>
        <thead>
          <tr>
            <th>Пункт</th>
            <th>Перерывов, отсч.</th>
            <th>Из них шлюз</th>
          </tr>
        </thead>
        <tbody>
          {dep.per_client.map((c) => (
            <tr key={c.client_id}>
              <td>{c.client_id}</td>
              <td>{c.outage_steps}</td>
              <td>{c.gateway_steps}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="note" style={{ marginTop: 10 }}>
        {dep.shared_blackout_steps > 0
          ? 'Единственный шлюз — общая точка отказа: когда над ним нет аппарата, связь теряют все пункты сразу. Резервные маршруты тут не помогают — рвётся последний участок. Помочь может только конфигурация, при которой над шлюзом всегда есть аппарат.'
          : 'Одновременных потерь связи по вине шлюза за период нет.'}
      </div>
      {dep.first_shared_blackout !== null && (
        <button
          className="btn btn-sm"
          style={{ marginTop: 10 }}
          onClick={() => p.onJump(dep.first_shared_blackout!)}
        >
          Показать первый общий провал
        </button>
      )}

      <h4 className="sect mono">Стабильность маршрутов</h4>
      <table className="data compact">
        <thead>
          <tr>
            <th>Пункт</th>
            <th>Смен</th>
            <th>Живёт</th>
            <th>Задержка</th>
            <th>Резерв</th>
          </tr>
        </thead>
        <tbody>
          {p.sim.metrics.map((m) => (
            <tr key={m.client_id}>
              <td>{m.client_id}</td>
              <td>{m.route_changes}</td>
              <td>{m.mean_route_lifetime_s === null ? '—' : formatDuration(m.mean_route_lifetime_s)}</td>
              <td>
                {m.mean_latency_ms === null
                  ? '—'
                  : `${num(m.mean_latency_ms)} / ${num(m.max_latency_ms)} мс`}
              </td>
              <td>{pct(m.backup_share)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="note" style={{ marginTop: 8 }}>
        Смена — переход маршрута на другие аппараты без разрыва связи. Резерв — доля времени, когда
        есть путь в обход всех аппаратов текущего маршрута: связь переживёт отказ любого из них.
      </div>

      <h4 className="sect mono">Загрузка аппаратов</h4>
      {usage.map((u) => (
        <div className="bar-row" key={u.id} onClick={() => p.onSelectSat(u.id)}>
          <span className="id">{u.id}</span>
          <span className="track">
            <span className="fill" style={{ width: `${(u.share / maxUsage) * 100}%` }} />
          </span>
          <span className="val">{pct(u.share)}</span>
        </div>
      ))}
      <div className="note" style={{ marginTop: 8 }}>
        Доля времени, когда аппарат несёт чей-то маршрут. Самые загруженные — первые кандидаты в
        уязвимые.
      </div>

      <h4 className="sect mono">Уязвимые аппараты</h4>
      <div className="note">
        Каждый запущенный аппарат по очереди отключается на весь период, и считается, насколько
        падает средняя доступность.
      </div>
      <button
        className="btn btn-sm"
        style={{ marginTop: 10 }}
        disabled={progress !== null}
        onClick={runVulnerable}
      >
        {progress === null ? 'Найти уязвимые' : 'Считаю…'}
      </button>
      {progress !== null && (
        <div className="progress">
          <i style={{ width: `${progress * 100}%` }} />
        </div>
      )}
      {vulnerable && (
        <>
          <table className="data compact" style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Аппарат</th>
                <th>Плоскость</th>
                <th>Средняя</th>
                <th>Худший пункт</th>
              </tr>
            </thead>
            <tbody>
              {vulnerable.list.slice(0, 8).map((v) => (
                <tr key={v.id} onClick={() => p.onSelectSat(v.id)}>
                  <td>{v.id}</td>
                  <td>{v.plane_id}</td>
                  <td>{`−${(v.mean_drop * 100).toFixed(2)} п.п.`}</td>
                  <td>{`${v.worst_client} −${(v.worst_drop * 100).toFixed(2)} п.п.`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {vulnerable.key !== key && (
            <div className="warn">Расчёт делался для другой конфигурации — запустите заново.</div>
          )}
        </>
      )}
    </>
  );
}
