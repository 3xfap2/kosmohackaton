/**
 * Лендинг переживает сбой глобуса.
 *
 * В jsdom нет WebGL — ровно та ситуация, что может случиться в браузере
 * эксперта. Глобус здесь намеренно не подменяется: он честно падает, и
 * страница должна остаться на месте, а не превратиться в пустой экран.
 */
// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import Landing from '../src/routes/Landing';

const scenarioJson = readFileSync(
  join(__dirname, '..', 'public', 'scenarios', '01_full_constellation.json'),
  'utf-8',
);

beforeAll(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ json: async () => JSON.parse(scenarioJson) }) as unknown as Response),
  );
  // Сбой глобуса здесь ожидаем — глушим его вывод, чтобы не засорять отчёт.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(cleanup);

describe('лендинг без WebGL', () => {
  it('остаётся на экране, когда глобус не смог запуститься', async () => {
    render(
      <MemoryRouter>
        <Landing />
      </MemoryRouter>,
    );

    // Сценарий посчитан — значит, глобус уже пытался смонтироваться.
    await waitFor(() =>
      expect(screen.getByText('худший пункт').previousElementSibling?.textContent).not.toBe('—'),
    );

    // Глобус упал и заменён запасным вариантом — тест действительно проверяет сбой.
    await waitFor(() => expect(document.querySelector('.globe')).toBeNull());

    // Страница при этом жива: заголовок и главное действие на месте.
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Связь на севере');
    expect(screen.getAllByText('Открыть рабочее место').length).toBeGreaterThan(0);
  });
});
