"""Снимает эталонные снапшоты с исходного geometry.py — основа для сверки TS-ядра."""
from __future__ import annotations
import json, sys
from pathlib import Path

APP = Path(__file__).resolve().parent.parent
CASE = APP.parent
sys.path.insert(0, str(CASE / 'Расчетный модуль'))

import geometry  # noqa: E402

SCENARIOS = ['01_full_constellation', '02_first_launch', '03_satellite_outages', '04_link_range']
TIMES = [0, 120, 3600, 21599, 21600, 43200, 86280]


def main() -> None:
    out = APP / 'tests' / 'fixtures'
    index = []
    for name in SCENARIOS:
        scenario = geometry.load(APP / 'public' / 'scenarios' / f'{name}.json')
        snaps = {}
        for t in TIMES:
            snap = geometry.snapshot(scenario, t)
            # Рёбра сортируем: порядок пар в numpy не гарантирован между реализациями.
            snap['edges'] = sorted(snap['edges'], key=lambda e: (e[0], e[1]))
            snaps[str(t)] = snap
        path = out / f'{name}.snapshots.json'
        path.write_text(json.dumps(snaps, ensure_ascii=False, allow_nan=False), encoding='utf-8')
        edges = sum(len(s['edges']) for s in snaps.values())
        index.append({'scenario': name, 'times': TIMES, 'total_edges': edges})
        print(f'{name}: {len(snaps)} снапшотов, {edges} рёбер суммарно, {path.stat().st_size // 1024} КБ')
    (out / 'index.json').write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
