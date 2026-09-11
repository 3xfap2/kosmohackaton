/** Форма периода недоступности спутника — требование ТЗ «в экранных формах». */
import { useEffect, useState } from 'react';
import { clock } from './format';
import type { Failure, Scenario } from '../../core/types';

interface Props {
  scenario: Scenario;
  /** Если задан — форма для конкретного аппарата, без выбора из списка. */
  satelliteId?: string;
  /** Начало по умолчанию, секунды — обычно текущий момент таймлайна. */
  defaultStart: number;
  onAdd: (failure: Failure) => void;
}

export default function FailureForm({ scenario, satelliteId, defaultStart, onAdd }: Props) {
  const { horizon_s, step_s } = scenario.environment;
  const [sat, setSat] = useState(satelliteId ?? scenario.design.satellites[0]?.id ?? '');
  const [start, setStart] = useState(defaultStart / 60);
  const [end, setEnd] = useState(horizon_s / 60);
  const [error, setError] = useState('');

  useEffect(() => setStart(defaultStart / 60), [defaultStart]);
  useEffect(() => setEnd(horizon_s / 60), [horizon_s]);
  useEffect(() => {
    if (satelliteId) setSat(satelliteId);
  }, [satelliteId]);

  const submit = () => {
    const s = Math.round(start * 60);
    const e = Math.round(end * 60);
    if (!scenario.design.satellites.some((x) => x.id === sat)) return setError('Выберите аппарат.');
    if (!Number.isFinite(s) || !Number.isFinite(e)) return setError('Укажите начало и конец периода.');
    if (s < 0 || e > horizon_s) {
      return setError(`Период должен лежать внутри расчёта: от 0 до ${horizon_s / 60} мин.`);
    }
    if (s >= e) return setError('Конец периода должен быть позже начала.');
    setError('');
    onAdd({ satellite_id: sat, start_s: s, end_s: e });
  };

  return (
    <div className="failure-form">
      {!satelliteId && (
        <div className="field">
          <span>Аппарат</span>
          <select aria-label="Аппарат для отказа" value={sat} onChange={(e) => setSat(e.target.value)}>
            {scenario.design.satellites.map((s) => (
              <option key={s.id} value={s.id}>
                {`${s.id} · ${s.plane_id} · очередь ${s.launch_batch}`}
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
            aria-label="Начало отказа, мин"
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
            aria-label="Конец отказа, мин"
            min={0}
            max={horizon_s / 60}
            step={step_s / 60}
            value={end}
            onChange={(e) => setEnd(Number(e.target.value))}
          />
        </label>
      </div>
      <button className="btn btn-sm" onClick={submit}>
        {satelliteId ? 'Отключить аппарат' : 'Добавить период'}
      </button>
      {error && <div className="form-err">{error}</div>}
    </div>
  );
}
