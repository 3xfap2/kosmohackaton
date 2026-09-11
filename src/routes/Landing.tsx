/**
 * Обзорная страница.
 *
 * Показатели и параметры модели не зашиты в вёрстку: демо-сценарий грузится и
 * считается тем же ядром, что и рабочее место. Показывать на витрине цифры,
 * не подтверждённые расчётом, нельзя — это первый вопрос эксперта.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Globe from '../components/Globe';
import ErrorBoundary from '../components/ErrorBoundary';
import { simulate } from '../core/simulate';
import type { Scenario } from '../core/types';

const PROBLEMS = [
  {
    title: 'Видимость — ещё не связь',
    text: 'Аппарат над пунктом не значит, что данные дойдут до шлюза. Нужен сквозной маршрут, а он рвётся там, где расходятся плоскости.',
  },
  {
    title: 'Один шлюз — общая точка отказа',
    text: 'Когда шлюз не видит ни одного аппарата, связь теряют все пункты сразу. Такую зависимость не видно, пока не посчитаешь сутки целиком.',
  },
  {
    title: 'Развёртывание идёт очередями',
    text: 'На первой очереди из 16 аппаратов сеть ведёт себя принципиально иначе, чем на полной. Решение о конфигурации принимают заранее.',
  },
];

const FEATURES = [
  {
    title: 'Состояние сети в любой момент',
    text: 'Положения аппаратов, межспутниковые связи и наземные линии на каждом из 720 отсчётов суток.',
  },
  {
    title: 'Маршрут с разбором причины',
    text: 'Когда пути нет, сервис называет причину: нет видимого аппарата, разрыв сети, нет контакта со шлюзом или шлюз недоступен.',
  },
  {
    title: 'Правка конфигурации',
    text: 'Очередь запуска, ориентация плоскостей и фазирование меняются в формах. Пересчёт — десятки миллисекунд.',
  },
  {
    title: 'Сравнение вариантов',
    text: 'Сохраняйте конфигурации и сопоставляйте их по доступности, перерывам и маршрутам на одном периоде.',
  },
  {
    title: 'Анализ отказов',
    text: 'Задайте период недоступности аппарата и посмотрите, где маршрут перестроился, а где возник перерыв.',
  },
  {
    title: 'Свой сценарий',
    text: 'Загрузите файл в формате кейса с другими пунктами и параметрами — сервис посчитает его так же, как встроенные.',
  },
];

const pad = (n: number): string => String(n).padStart(2, '0');

export default function Landing() {
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [t, setT] = useState(0);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}scenarios/01_full_constellation.json`)
      .then((r) => r.json())
      .then(setScenario);
  }, []);

  // Витринная анимация: аппараты идут по орбитам, маршрут перестраивается.
  useEffect(() => {
    const id = setInterval(() => setT((v) => (v + 120) % 86400), 90);
    return () => clearInterval(id);
  }, []);

  const sim = useMemo(() => (scenario ? simulate(scenario) : null), [scenario]);
  const client = sim?.metrics[0]?.client_id;
  const step = client && sim ? sim.steps[client][Math.floor(t / 120) % sim.times.length] : null;
  const worst = sim ? Math.min(...sim.metrics.map((m) => m.availability)) : 0;
  const env = scenario?.environment;

  return (
    <div className="page">
      <header className="hero">
        <div className="wrap hero-inner">
          <div>
            <div className="eyebrow mono">
              <span className="dash">—</span>КосмоХакатон 2026 / Кадры для космоса
            </div>
            <h1 className="display">
              Связь на севере до того,{' '}
              <span style={{ color: 'var(--granite)' }}>как запущен первый аппарат</span>
            </h1>
            <p className="lead">
              Сервис проектирования спутниковой группировки. Подбираете конфигурацию, проверяете её
              на отказах и видите, получает ли каждый наземный пункт связь со шлюзом.
            </p>
            <div className="hero-actions">
              <Link className="btn btn-primary" to="/app">
                Открыть рабочее место
              </Link>
              <Link className="btn btn-ghost" to="/method">
                Методика расчёта
              </Link>
            </div>

            <div className="tiles">
              <div className="tile">
                <div className="v">{scenario ? scenario.design.satellites.length : '—'}</div>
                <div className="k mono">аппаратов</div>
              </div>
              <div className="tile">
                <div className="v">{sim ? sim.times.length : '—'}</div>
                <div className="k mono">отсчётов в сутках</div>
              </div>
              <div className="tile">
                <div className="v">{sim ? `${sim.elapsed_ms.toFixed(0)} мс` : '—'}</div>
                <div className="k mono">полный пересчёт</div>
              </div>
              <div className="tile">
                <div className="v">{sim ? `${(worst * 100).toFixed(1)}%` : '—'}</div>
                <div className="k mono">худший пункт</div>
              </div>
            </div>
          </div>

          <div className="hero-globe">
            {scenario && (
              <ErrorBoundary fallback={null}>
                <Globe
                  scenario={scenario}
                  t_s={t}
                  routePath={step?.path ?? []}
                  autoRotate
                  interactive
                  showLinks
                />
              </ErrorBoundary>
            )}
          </div>
        </div>
      </header>

      <section className="band">
        <div className="wrap">
          <div className="section-head">
            <div className="eyebrow mono">
              <span className="dash">01</span>Задача
            </div>
            <h2 className="heading">48 аппаратов должны связать север со шлюзом</h2>
            <p>
              Запуск идёт тремя очередями по 16 аппаратов. Между очередями и при отказах сеть
              ведёт себя по-разному, а решение о конфигурации принимается один раз.
            </p>
          </div>
          <div className="grid c3">
            {PROBLEMS.map((p, i) => (
              <div className="item" key={p.title}>
                <div className="num mono">{pad(i + 1)}</div>
                <h3 className="heading-sm">{p.title}</h3>
                <p>{p.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="band">
        <div className="wrap">
          <div className="section-head">
            <div className="eyebrow mono">
              <span className="dash">02</span>Возможности
            </div>
            <h2 className="heading">Инструмент инженера, а не презентация</h2>
            <p>
              Каждая цифра на экране получена расчётом по формулам кейса. Ничего не посчитано
              заранее — эксперт загружает свой сценарий и получает свои числа.
            </p>
          </div>
          <div className="grid c3">
            {FEATURES.map((f, i) => (
              <div className="item" key={f.title}>
                <div className="num mono">{pad(i + 1)}</div>
                <h3 className="heading-sm">{f.title}</h3>
                <p>{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="band">
        <div className="wrap grid c2" style={{ alignItems: 'start' }}>
          <div>
            <div className="eyebrow mono">
              <span className="dash">03</span>Доверие к расчёту
            </div>
            <h2 className="heading">Сверено с эталонным модулем кейса</h2>
            <p className="lead">
              Расчётное ядро переписано на TypeScript и сверяется с приложенным к кейсу geometry.py:
              координаты, состав связей и углы возвышения совпадают с точностью до 10⁻⁹ на четырёх
              сценариях и семи моментах времени.
            </p>
            <Link className="btn btn-ghost" to="/method">
              Смотреть методику
            </Link>
          </div>

          <div className="light-card">
            <div className="mono">Параметры модели</div>
            {env && (
              <dl>
                <dt>Орбита</dt>
                <dd>{`круговая, ${env.altitude_km} км, наклонение ${env.inclination_deg}°`}</dd>
                <dt>Шаг расчёта</dt>
                <dd>{`${env.step_s} с, горизонт ${env.horizon_s / 3600} ч`}</dd>
                <dt>Порог связи</dt>
                <dd>{`угол возвышения не ниже ${env.min_elevation_deg}°`}</dd>
                <dt>Дальность ISL</dt>
                <dd>{`${env.isl_range_km} км`}</dd>
                <dt>Маршрутизация</dt>
                <dd>поиск в ширину по числу переходов</dd>
                <dt>Проверка</dt>
                <dd>автотесты, включая побитовую сверку с эталоном</dd>
              </dl>
            )}
          </div>
        </div>
      </section>

      <section className="cta-band">
        <div className="wrap">
          <h2 className="heading" style={{ margin: 0 }}>
            Посмотрите, где группировка теряет связь
          </h2>
          <Link className="btn btn-primary" to="/app">
            Открыть рабочее место
          </Link>
        </div>
      </section>

      <footer className="site">
        <div className="wrap mono">
          <span>КосмоХакатон 2026 / Устойчивая спутниковая группировка</span>
          <span>Данные сценариев синтетические</span>
        </div>
      </footer>
    </div>
  );
}
