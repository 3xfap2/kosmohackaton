/**
 * Рабочее место в браузерном окружении — базовые сценарии проверки из ТЗ.
 *
 * Глобус подменяется заглушкой: в jsdom нет WebGL, а сам глобус — только
 * представление расчёта. Его устойчивость к сбою проверяет отдельный тест.
 */
// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const downloads = vi.hoisted(() => [] as Array<{ name: string; data: unknown }>);

vi.mock('../src/components/Globe', () => ({
  default: () => <div data-testid="globe-stub" />,
  PLANE_COLORS: ['#eeeeee', '#a0ca92', '#b8b3b0'],
}));

// Скачивание файла в jsdom не работает — перехватываем и проверяем содержимое.
vi.mock('../src/components/workspace/format', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/components/workspace/format')>()),
  downloadJson: (name: string, data: unknown) => {
    downloads.push({ name, data });
  },
}));

const { default: Workspace } = await import('../src/routes/Workspace');
const { AuthProvider } = await import('../src/auth/AuthContext');

const PUBLIC = join(__dirname, '..', 'public', 'scenarios');
const fileText = (name: string): string => readFileSync(join(PUBLIC, `${name}.json`), 'utf-8');

beforeAll(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const name = String(url).split('/').pop()!.replace('.json', '');
      const text = fileText(name);
      return { text: async () => text, json: async () => JSON.parse(text) } as unknown as Response;
    }),
  );
});

beforeEach(() => {
  localStorage.clear();
  downloads.length = 0;
});
afterEach(cleanup);

/** Локальный профиль: сохранение своих вариантов доступно только после входа. */
const signIn = () => {
  const id = 'test-user';
  localStorage.setItem(
    'cosmo.accounts',
    JSON.stringify([{ id, name: 'Инженер Тест', email: 'engineer@example.ru', passwordHash: 'x' }]),
  );
  localStorage.setItem('cosmo.session', id);
};

const summary = (): string => screen.queryByTestId('target-summary')?.textContent ?? '';
const openTab = (name: string) => fireEvent.click(screen.getByRole('tab', { name }));
const routeBox = (): HTMLElement => document.querySelector('.route-box') as HTMLElement;

const renderWorkspace = async () => {
  render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/app']}>
        <Workspace />
      </MemoryRouter>
    </AuthProvider>,
  );
  await waitFor(() => expect(summary()).toMatch(/достигают/));
};

const upload = async (name: string, text: string) => {
  const input = screen.getByTestId('upload');
  await act(async () => {
    fireEvent.change(input, {
      target: { files: [new File([text], name, { type: 'application/json' })] },
    });
  });
};

describe('рабочее место — базовые сценарии проверки', () => {
  it('полная группировка: открывается посчитанной, виден маршрут до шлюза', async () => {
    await renderWorkspace();
    expect(summary()).toContain('достигают 3 из 3');
    expect(routeBox().querySelector('.chain')?.textContent).toMatch(/^C65 → .+ → G_MUR$/);
  });

  it('этап развёртывания: первая очередь пересчитывает доступность', async () => {
    await renderWorkspace();
    openTab('Конфигурация');
    fireEvent.change(screen.getByLabelText('Этап развёртывания'), { target: { value: '1' } });
    await waitFor(() => expect(summary()).toContain('достигают 0 из 3'));
  });

  it('отказ аппарата маршрута: маршрут обходит его или возникает перерыв', async () => {
    await renderWorkspace();
    const chip = within(routeBox()).getAllByRole('button')[0];
    const id = chip.textContent!;
    fireEvent.click(chip);

    const card = await screen.findByTestId('sat-card');
    fireEvent.click(within(card).getByText('Отключить аппарат'));

    await waitFor(() => {
      const chain = routeBox().querySelector('.chain');
      const rerouted = chain ? !chain.textContent!.split(' → ').includes(id) : false;
      expect(rerouted || routeBox().textContent!.includes('Маршрута нет')).toBe(true);
    });
    expect(within(await screen.findByTestId('sat-card')).getByText(/в отказе до/)).toBeTruthy();
  });

  it('изменение проекта: вариант сохраняется, сравнивается и попадает в рекомендацию', async () => {
    signIn();
    await renderWorkspace();
    openTab('Сравнение');
    fireEvent.change(screen.getByPlaceholderText('Название варианта'), {
      target: { value: 'Полная' },
    });
    fireEvent.click(screen.getByText('Сохранить'));

    openTab('Конфигурация');
    fireEvent.change(screen.getByLabelText('RAAN плоскости P2, °'), { target: { value: '85' } });

    openTab('Сравнение');
    const table = await screen.findByTestId('compare-table');
    expect(within(table).getByText('Полная')).toBeTruthy();
    expect(within(table).getByText('Текущая конфигурация')).toBeTruthy();
    expect(within(table).getAllByText(/P2 RAAN/).length).toBeGreaterThan(0);
    expect(screen.getByTestId('recommendation').textContent).toContain('Рекомендация');
  });

  it('без входа сохранение закрыто, но эталонное сравнение и рекомендация доступны', async () => {
    await renderWorkspace();
    openTab('Сравнение');

    expect(screen.queryByPlaceholderText('Название варианта')).toBeNull();
    expect(screen.getByText('Войти или создать профиль')).toBeTruthy();

    const table = await screen.findByTestId('compare-table');
    expect(within(table).getByText('Эталон · одна очередь, 16 аппаратов')).toBeTruthy();
    expect(within(table).getByText('Эталон · две очереди, 32 аппарата')).toBeTruthy();
    expect(within(table).getByText('Эталон · отказ 10 аппаратов')).toBeTruthy();
    expect(screen.getByTestId('recommendation').textContent).toContain('Рекомендация');
  });

  it('выгрузка результата и повторная загрузка дают те же показатели', async () => {
    await renderWorkspace();
    const before = summary();

    fireEvent.click(screen.getByText('↓ Результат'));
    expect(downloads).toHaveLength(1);
    expect(downloads[0].name).toBe('01_full_constellation_result.json');
    const result = downloads[0].data as { schema_version: string; routes: unknown[] };
    expect(result.schema_version).toBe('cosmo-A-result-1.0');
    expect(result.routes).toHaveLength(720 * 3);

    await upload('результат.json', JSON.stringify(result));
    await waitFor(() =>
      expect(
        (screen.getByLabelText('Сценарий') as HTMLSelectElement).selectedOptions[0].textContent,
      ).toContain('результат.json'),
    );
    expect(summary()).toBe(before);
  });

  it('некорректный файл: сервис называет поля и не трогает текущий сценарий', async () => {
    await renderWorkspace();
    const broken = JSON.parse(fileText('01_full_constellation'));
    delete broken.environment.step_s;
    broken.design.satellites[5].plane_id = 'P9';

    await upload('broken.json', JSON.stringify(broken));
    const box = await screen.findByTestId('load-errors');
    expect(box.textContent).toContain('environment.step_s');
    expect(box.textContent).toContain('plane_id');
    expect(summary()).toContain('достигают 3 из 3');
  });

  it('свой сценарий с другими пунктами загружается и считается', async () => {
    await renderWorkspace();
    const custom = JSON.parse(fileText('01_full_constellation'));
    custom.meta.id = 'jury_check';
    custom.ground_sites[1].lat_deg = 60;
    custom.ground_sites.push({
      id: 'C80',
      name: 'Проверочный пункт',
      role: 'client',
      lat_deg: 80,
      lon_deg: 10,
    });

    await upload('jury.json', JSON.stringify(custom));
    await waitFor(() => expect(summary()).toMatch(/из 4$/));
    expect(screen.getAllByText('C80').length).toBeGreaterThan(0);
  });

  it('сброс возвращает сценарий к загруженному состоянию', async () => {
    await renderWorkspace();
    openTab('Конфигурация');
    fireEvent.change(screen.getByLabelText('Этап развёртывания'), { target: { value: '1' } });
    await waitFor(() => expect(summary()).toContain('0 из 3'));

    fireEvent.click(screen.getByText('Сброс'));
    await waitFor(() => expect(summary()).toContain('3 из 3'));
  });

  it('клик по аппарату на карте показывает его номер и состояние', async () => {
    await renderWorkspace();
    fireEvent.click(screen.getByText('Карта'));
    fireEvent.click(document.querySelector('[data-sat-id="S01"]')!);

    const card = await screen.findByTestId('sat-card');
    expect(card.textContent).toContain('S01');
    expect(card.textContent).toMatch(/активен|не запущен|в отказе/);
  });

  it('«Перерыв ›» переводит таймлайн к началу ближайшего перерыва', async () => {
    await renderWorkspace();
    fireEvent.click(screen.getByText('Перерыв ›'));
    await waitFor(() => expect(routeBox().textContent).toContain('Маршрута нет'));
  });

  it('«Диагноз» открывает заключение и запускает расчёт', async () => {
    await renderWorkspace();
    fireEvent.click(screen.getByText('Диагноз'));

    const panel = await screen.findByTestId('diagnosis');
    expect(panel.textContent).toContain('Диагноз проекта');
    expect(panel.textContent).toMatch(/Считаю|Целевой уровень/);
  });

  it('вкладка устойчивости показывает общую зависимость от шлюза', async () => {
    await renderWorkspace();
    openTab('Устойчивость');
    expect(screen.getByTestId('gateway-dependency').textContent).toContain('16 мин');
  });
});
