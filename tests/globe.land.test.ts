/**
 * Контуры материков для глобуса.
 *
 * Строятся без WebGL, поэтому проверяются напрямую на реальном наборе
 * world-atlas. Этот тест ловит сбой, из-за которого глобус ронял страницу:
 * объект land — GeometryCollection, и topojson.feature() возвращает для него
 * FeatureCollection, а не одиночный Feature.
 */
import { describe, expect, it } from 'vitest';
import { buildLandSegments } from '../src/components/Globe';

describe('контуры суши для глобуса', () => {
  it('разбирают набор world-atlas и дают отрезки на сфере заданного радиуса', () => {
    const pts = buildLandSegments(1.002);

    // Отрезок — две точки по три координаты; материков — тысячи отрезков.
    expect(pts.length % 6).toBe(0);
    expect(pts.length / 6).toBeGreaterThan(1000);

    // Каждая точка лежит на сфере: выборка по всему массиву, с шагом кратным трём.
    for (let i = 0; i < pts.length; i += 3 * 97) {
      expect(Math.hypot(pts[i], pts[i + 1], pts[i + 2])).toBeCloseTo(1.002, 9);
    }
  });
});
