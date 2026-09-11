/** Заключение по проекту одной кнопкой: сервис формулирует выводы сам. */
import { useEffect, useRef, useState } from 'react';
import { diagnose, type Diagnosis } from '../../core/diagnose';
import type { SimulationResult } from '../../core/simulate';
import type { Scenario } from '../../core/types';

interface Props {
  scenario: Scenario;
  sim: SimulationResult;
  onClose: () => void;
}

export default function DiagnosisPanel({ scenario, sim, onClose }: Props) {
  const [result, setResult] = useState<Diagnosis | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 1, phase: 'подготовка' });
  const [copied, setCopied] = useState(false);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    void diagnose(scenario, sim, {
      onProgress: (done, total, phase) => setProgress({ done, total, phase }),
      isCancelled: () => cancelled.current,
    }).then((d) => {
      if (d && !cancelled.current) setResult(d);
    });
    return () => {
      cancelled.current = true;
    };
  }, [scenario, sim]);

  const copy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.report);
      setCopied(true);
    } catch {
      // Буфер обмена недоступен — текст можно выделить прямо на экране.
      setCopied(false);
    }
  };

  return (
    <div className="overlay" role="dialog" aria-label="Диагноз проекта" data-testid="diagnosis">
      <div className="overlay-card">
        <div className="head">
          <div>
            <div className="mono" style={{ color: 'var(--signal)' }}>
              Диагноз проекта
            </div>
            <h3 className="heading-sm" style={{ marginTop: 10 }}>
              {scenario.meta.title || scenario.meta.id}
            </h3>
          </div>
          <button className="btn btn-bare btn-sm" onClick={onClose}>
            Закрыть
          </button>
        </div>

        {result === null ? (
          <>
            <div className="note">
              {`Считаю: ${progress.phase} · ${progress.done} из ${progress.total} прогонов`}
            </div>
            <div className="progress">
              <i style={{ width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` }} />
            </div>
            <div className="note">
              По очереди отключаю каждый запущенный аппарат, перебираю схемы ориентации плоскостей
              и проверяю проект на одновременный отказ самых уязвимых. Обычно несколько секунд.
            </div>
          </>
        ) : (
          <>
            {result.findings.map((f) => (
              <div className={`finding ${f.tone}`} key={f.id}>
                <div className="finding-title">{f.title}</div>
                <p>{f.text}</p>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
              <button className="btn btn-sm" onClick={copy}>
                {copied ? 'Скопировано' : 'Скопировать текст'}
              </button>
              <button className="btn btn-sm btn-ghost" onClick={onClose}>
                Закрыть
              </button>
            </div>
            <div className="note" style={{ marginTop: 12 }}>
              Текст готов для записки и презентации: все числа получены расчётом этой же модели.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
