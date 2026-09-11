import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DragEvent } from 'react';
import Globe from '../components/Globe';
import MapView from '../components/MapView';
import ErrorBoundary from '../components/ErrorBoundary';
import ScenarioBar from '../components/workspace/ScenarioBar';
import NetworkTab from '../components/workspace/NetworkTab';
import ConfigTab from '../components/workspace/ConfigTab';
import CompareTab from '../components/workspace/CompareTab';
import ResilienceTab from '../components/workspace/ResilienceTab';
import TimelineBar from '../components/workspace/TimelineBar';
import DiagnosisPanel from '../components/workspace/DiagnosisPanel';
import { PRESETS, type Source, type Tab, type ViewMode } from '../components/workspace/model';
import { downloadJson, pct, readFileText } from '../components/workspace/format';
import { simulate } from '../core/simulate';
import { snapshot } from '../core/geometry';
import { parseScenarioText } from '../core/validate';
import { buildResult, exportFileName } from '../core/export';
import {
  listVariants,
  makeReference,
  removeVariant,
  sameGroundSites,
  saveVariant,
  type Variant,
} from '../core/variants';
import { useAuth } from '../auth/AuthContext';
import type { Failure, Scenario } from '../core/types';

/** Три обязательных расчёта из ТЗ: их сравнение доступно без входа. */
const REFERENCES = [
  { file: '01_full_constellation', name: 'Эталон · полная группировка' },
  { file: '02_first_launch', name: 'Эталон · первая очередь' },
  { file: '03_satellite_outages', name: 'Эталон · отказ 10 аппаратов' },
];

const TABS: Array<[Tab, string]> = [
  ['network', 'Сеть'],
  ['config', 'Конфигурация'],
  ['compare', 'Сравнение'],
  ['resilience', 'Устойчивость'],
];

export default function Workspace() {
  const { profile } = useAuth();
  const owner = profile?.id ?? null;

  const [scenario, setScenario] = useState<Scenario | null>(null);
  /** Состояние сразу после загрузки — для кнопки «Сброс». */
  const [original, setOriginal] = useState<Scenario | null>(null);
  const [source, setSource] = useState<Source>({ kind: 'preset', file: PRESETS[0].file });
  const [loadErrors, setLoadErrors] = useState<{ file: string; errors: string[] } | null>(null);
  const [cursor, setCursor] = useState(0);
  const [client, setClient] = useState('');
  const [selectedSat, setSelectedSat] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('network');
  const [view, setView] = useState<ViewMode>('globe');
  const [globeFailed, setGlobeFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [references, setReferences] = useState<Variant[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [showDiagnosis, setShowDiagnosis] = useState(false);

  const adopt = useCallback((s: Scenario, src: Source) => {
    setScenario(s);
    setOriginal(structuredClone(s));
    setSource(src);
    setCursor(0);
    setSelectedSat(null);
    setLoadErrors(null);
    setPlaying(false);
  }, []);

  const loadPreset = useCallback(
    async (file: string) => {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}scenarios/${file}.json`);
        const parsed = parseScenarioText(await response.text());
        if (parsed.ok) adopt(parsed.scenario, { kind: 'preset', file });
        else setLoadErrors({ file: `${file}.json`, errors: parsed.errors });
      } catch (e) {
        setLoadErrors({
          file: `${file}.json`,
          errors: [`Не удалось загрузить: ${(e as Error).message}`],
        });
      }
    },
    [adopt],
  );

  const loadFile = useCallback(
    async (file: File) => {
      const parsed = parseScenarioText(await readFileText(file));
      if (parsed.ok) adopt(parsed.scenario, { kind: 'file', label: file.name });
      else setLoadErrors({ file: file.name, errors: parsed.errors });
    },
    [adopt],
  );

  useEffect(() => {
    void loadPreset(PRESETS[0].file);
  }, [loadPreset]);

  // Свои варианты живут в профиле; без входа их нет.
  useEffect(() => setVariants(profile ? listVariants(owner) : []), [owner, profile]);

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      REFERENCES.map(async (r) => {
        const response = await fetch(`${import.meta.env.BASE_URL}scenarios/${r.file}.json`);
        const parsed = parseScenarioText(await response.text());
        return parsed.ok ? makeReference(r.file, r.name, parsed.scenario) : null;
      }),
    )
      .then((list) => {
        if (!cancelled) setReferences(list.filter((x): x is Variant => x !== null));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const sim = useMemo(() => (scenario ? simulate(scenario) : null), [scenario]);
  const index = sim ? Math.min(cursor, sim.times.length - 1) : 0;
  const t = sim ? (sim.times[index] ?? 0) : 0;
  const snap = useMemo(() => (scenario ? snapshot(scenario, t) : null), [scenario, t]);

  // Выбранные пункт и аппарат должны существовать в текущем сценарии.
  useEffect(() => {
    if (!scenario) return;
    const clients = scenario.ground_sites.filter((g) => g.role === 'client');
    if (!clients.some((c) => c.id === client)) setClient(clients[0]?.id ?? '');
    if (selectedSat && !scenario.design.satellites.some((s) => s.id === selectedSat)) {
      setSelectedSat(null);
    }
  }, [scenario, client, selectedSat]);

  useEffect(() => {
    if (!playing || !sim) return;
    const id = setInterval(() => setCursor((c) => Math.min(c + 1, sim.times.length - 1)), 70);
    return () => clearInterval(id);
  }, [playing, sim]);

  useEffect(() => {
    if (playing && sim && index >= sim.times.length - 1) setPlaying(false);
  }, [playing, sim, index]);

  const dirty = useMemo(
    () => JSON.stringify(scenario) !== JSON.stringify(original),
    [scenario, original],
  );

  if (!scenario || !sim || !snap) {
    return (
      <div className="workspace" style={{ padding: 28 }}>
        {loadErrors ? (
          <div className="load-errors" data-testid="load-errors" role="alert">
            <div className="title">{`Файл «${loadErrors.file}» не загружен:`}</div>
            <ul>
              {loadErrors.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        ) : (
          'Загрузка сценария…'
        )}
      </div>
    );
  }

  const addFailure = (f: Failure) =>
    setScenario({ ...scenario, failures: [...scenario.failures, f] });
  const removeFailure = (i: number) =>
    setScenario({ ...scenario, failures: scenario.failures.filter((_, k) => k !== i) });
  const reset = () => {
    if (!original) return;
    setScenario(structuredClone(original));
    setCursor(0);
    setSelectedSat(null);
  };
  const openVariant = (v: Variant) =>
    adopt(structuredClone(v.scenario), { kind: 'variant', label: v.name });
  const selectSatellite = (id: string) => {
    setSelectedSat(id);
    setTab('network');
  };
  const selectSite = (id: string) => {
    if (scenario.ground_sites.some((g) => g.id === id && g.role === 'client')) setClient(id);
  };

  const launched = scenario.design.satellites.filter(
    (s) => s.launch_batch <= scenario.design.launch_stage,
  ).length;
  const route = sim.steps[client]?.[index]?.path ?? [];
  // Эталон сравним только с тем же составом наземных пунктов; совпадающий с
  // текущим сценарием эталон прячем, иначе вариант сравнивался бы сам с собой.
  const currentKey = JSON.stringify(scenario);
  const comparableReferences = references.filter(
    (r) => sameGroundSites(r.scenario, scenario) && JSON.stringify(r.scenario) !== currentKey,
  );

  const map = (
    <MapView
      scenario={scenario}
      t_s={t}
      routePath={route}
      selectedClient={client}
      selectedSatellite={selectedSat}
      onSelectSatellite={selectSatellite}
      onSelectSite={selectSite}
    />
  );

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void loadFile(file);
  };

  return (
    <div
      className="workspace"
      onDragOver={(e) => {
        e.preventDefault();
        if (!dragOver) setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
      }}
      onDrop={onDrop}
    >
      <ScenarioBar
        source={source}
        onPreset={(file) => void loadPreset(file)}
        onFile={(file) => void loadFile(file)}
        dirty={dirty}
        onReset={reset}
        onExportScenario={() => downloadJson(exportFileName(scenario, '_edited'), scenario)}
        onExportResult={() => downloadJson(exportFileName(scenario, '_result'), buildResult(sim))}
        onDiagnose={() => setShowDiagnosis(true)}
        view={view}
        onView={setView}
        globeFailed={globeFailed}
        info={`${launched} из ${scenario.design.satellites.length} аппаратов · ${sim.times.length} отсчётов · расчёт ${sim.elapsed_ms.toFixed(0)} мс`}
        target={`Цель ${pct(scenario.environment.target_availability)} · достигают ${sim.clients_meeting_target} из ${sim.metrics.length}`}
      />

      {loadErrors && (
        <div className="load-errors" data-testid="load-errors" role="alert">
          <div className="title">
            {`Файл «${loadErrors.file}» не загружен — исправьте ${
              loadErrors.errors.length === 1 ? 'ошибку' : `ошибки (${loadErrors.errors.length})`
            }:`}
          </div>
          <ul>
            {loadErrors.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
          <button className="btn btn-sm btn-bare" onClick={() => setLoadErrors(null)}>
            Закрыть
          </button>
          <span className="note" style={{ marginLeft: 12 }}>
            Текущий сценарий не изменён.
          </span>
        </div>
      )}

      <div className="ws-main">
        <div className="ws-view">
          {view === 'globe' && !globeFailed ? (
            <ErrorBoundary
              fallback={map}
              onError={() => {
                setGlobeFailed(true);
                setView('map');
              }}
            >
              <Globe
                scenario={scenario}
                t_s={t}
                routePath={route}
                interactive
                showLinks
                showLabels
                selectedSatellite={selectedSat}
                onSelectSatellite={selectSatellite}
                onSelectSite={selectSite}
              />
            </ErrorBoundary>
          ) : (
            map
          )}
          <div className="view-hint mono">
            Клик по аппарату — его состояние · по пункту — выбор пункта
          </div>
        </div>

        <aside className="ws-side">
          <div className="tabs" role="tablist">
            {TABS.map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                className={tab === id ? 'on' : ''}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'network' && (
            <NetworkTab
              scenario={scenario}
              sim={sim}
              snap={snap}
              cursor={index}
              client={client}
              onClient={setClient}
              selectedSat={selectedSat}
              onSelectSat={setSelectedSat}
              onAddFailure={addFailure}
              onRemoveFailure={removeFailure}
            />
          )}
          {tab === 'config' && (
            <ConfigTab
              scenario={scenario}
              t={t}
              onChange={setScenario}
              onAddFailure={addFailure}
              onRemoveFailure={removeFailure}
            />
          )}
          {tab === 'compare' && (
            <CompareTab
              scenario={scenario}
              sim={sim}
              variants={[...comparableReferences, ...variants]}
              canSave={Boolean(profile)}
              onSave={(name) => setVariants(saveVariant(owner, name, scenario, sim.metrics))}
              onOpen={openVariant}
              onRemove={(id) => setVariants(removeVariant(owner, id))}
              onApply={setScenario}
            />
          )}
          {tab === 'resilience' && (
            <ResilienceTab
              scenario={scenario}
              sim={sim}
              onSelectSat={selectSatellite}
              onJump={(i) => {
                setCursor(i);
                setTab('network');
              }}
            />
          )}
        </aside>
      </div>

      <TimelineBar
        sim={sim}
        cursor={index}
        onCursor={setCursor}
        client={client}
        onClient={setClient}
        playing={playing}
        onPlaying={setPlaying}
      />

      {showDiagnosis && (
        <DiagnosisPanel scenario={scenario} sim={sim} onClose={() => setShowDiagnosis(false)} />
      )}

      {dragOver && <div className="drop-overlay mono">Отпустите файл сценария</div>}
    </div>
  );
}
