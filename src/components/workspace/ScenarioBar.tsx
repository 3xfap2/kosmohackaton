/** Верхняя панель: источник сценария, загрузка, сброс, вид и выгрузка. */
import { useRef } from 'react';
import { PRESETS, type Source, type ViewMode } from './model';

interface Props {
  source: Source;
  onPreset: (file: string) => void;
  onFile: (file: File) => void;
  dirty: boolean;
  onReset: () => void;
  onExportScenario: () => void;
  onExportResult: () => void;
  view: ViewMode;
  onView: (view: ViewMode) => void;
  globeFailed: boolean;
  info: string;
  target: string;
}

export default function ScenarioBar(p: Props) {
  const input = useRef<HTMLInputElement>(null);
  const value = p.source.kind === 'preset' ? p.source.file : '__custom';

  return (
    <div className="ws-bar">
      <select
        aria-label="Сценарий"
        value={value}
        onChange={(e) => {
          if (e.target.value !== '__custom') p.onPreset(e.target.value);
        }}
      >
        {p.source.kind !== 'preset' && (
          <option value="__custom">
            {`${p.source.kind === 'file' ? 'Файл' : 'Вариант'}: ${p.source.label}`}
          </option>
        )}
        {PRESETS.map((preset) => (
          <option key={preset.file} value={preset.file}>
            {preset.label}
          </option>
        ))}
      </select>

      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        hidden
        data-testid="upload"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) p.onFile(file);
          // Сбрасываем, чтобы повторный выбор того же файла снова сработал.
          e.target.value = '';
        }}
      />
      <button className="btn btn-sm" onClick={() => input.current?.click()} title="Или перетащите файл в окно">
        Загрузить файл
      </button>
      <button
        className="btn btn-sm btn-bare"
        onClick={p.onReset}
        disabled={!p.dirty}
        title="Вернуть сценарий к состоянию после загрузки"
      >
        Сброс
      </button>

      <div className="seg">
        <button
          className={p.view === 'globe' ? 'on' : ''}
          disabled={p.globeFailed}
          title={p.globeFailed ? 'WebGL недоступен в этом браузере — показана карта' : undefined}
          onClick={() => p.onView('globe')}
        >
          Глобус
        </button>
        <button className={p.view === 'map' ? 'on' : ''} onClick={() => p.onView('map')}>
          Карта
        </button>
      </div>

      <span className="mono">{p.info}</span>
      <div className="spacer" />
      <span className="mono" data-testid="target-summary">
        {p.target}
      </span>

      <div className="export-group">
        <button
          className="btn btn-sm btn-ghost"
          onClick={p.onExportScenario}
          title="Сценарий со всеми правками — формат cosmo-A-1.0, загружается обратно"
        >
          ↓ Сценарий
        </button>
        <button
          className="btn btn-sm btn-ghost"
          onClick={p.onExportResult}
          title="Маршруты по каждому отсчёту и показатели — формат cosmo-A-result-1.0"
        >
          ↓ Результат
        </button>
      </div>
    </div>
  );
}
