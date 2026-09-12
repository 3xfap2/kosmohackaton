/**
 * Период недоступности шлюза.
 *
 * Без него причина разрыва «шлюз недоступен» недостижима: во всех сценариях
 * кейса раздел gateway_outages пуст, и четвёртую причину нечем показать.
 */
import { useEffect, useState } from 'react';
import { clock } from './format';
import type { GatewayOutage, Scenario } from '../../core/types';

interface Props {
  scenario: Scenario;
  /** Начало по умолчанию, секунды — текущий момент таймлайна. */
  defaultStart: number;
  onAdd: (outage: GatewayOutage) => void;
}

export default function GatewayOutageForm({ scenario, defaultStart, onAdd }: Props) {
  const { horizon_s, step_s } = scenario.environment;
  const gateways = scenario.ground_sites.filter((g) => g.role === 'gateway');
  const [gateway, setGateway] = useState(gateways[0]?.id ?? '');
  const [start, setStart] = useState(defaultStart / 60);
  const [end, setEnd] = useState(Math.min(defaultStart + 3600, horizon_s) / 60);
  const [error, setError] = useState('');

  useEffect(() => setStart(defaultStart / 60), [defaultStart]);
  useEffect(() => {
    if (!gateways.some((g) => g.id === gateway)) setGateway(gateways[0]?.id ?? '');
  }, [gateways, gateway]);

  const submit = () => {
    const s = Math.round(start * 60);
    const e = Math.round(end * 60);
    if (!gateways.some((g) => g.id === gateway)) return setError('Выберите шлюз.');
    if (!Number.isFinite(s) || !Number.isFinite(e)) return setError('Укажите начало и конец периода.');
    if (s < 0 || e > horizon_s) {
      return setError(`Период должен лежать внутри расчёта: от 0 до ${horizon_s / 60} мин.`);
    }
    if (s >= e) return setError('Конец периода должен быть позже начала.');
    setError('');
    onAdd({ gateway_id: gateway, start_s: s, end_s: e });
  };

  if (gateways.length === 0) return null;

  return (
    <div className="failure-form">
      {gateways.length > 1 && (
        <div className="field">
          <span>Шлюз</span>
          <select
            aria-label="Шлюз для отключения"
            value={gateway}
            onChange={(e) => setGateway(e.target.value)}
          >
            {gateways.map((g) => (
              <option key={g.id} value={g.id}>
                {g.id}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="form-row">
        <label>
          <span>{`С, мин · ${clock(start * 60)}`}</span>
          <input
            type="number"
            aria-label="Начало недоступности шлюза, мин"
            min={0}
            max={horizon_s / 60}
            step={step_s / 60}
            value={start}
            onChange={(e) => setStart(Number(e.target.value))}
          />
        </label>
        <label>
          <span>{`До, мин · ${clock(end * 60)}`}</span>
          <input
            type="number"
            aria-label="Конец недоступности шлюза, мин"
            min={0}
            max={horizon_s / 60}
            step={step_s / 60}
            value={end}
            onChange={(e) => setEnd(Number(e.target.value))}
          />
        </label>
      </div>
      <button className="btn btn-sm" onClick={submit}>
        Отключить шлюз
      </button>
      {error && <div className="form-err">{error}</div>}
    </div>
  );
}
