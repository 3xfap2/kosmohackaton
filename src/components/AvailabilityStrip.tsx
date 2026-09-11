/** Диаграмма доступности по одному пункту: цвет отсчёта — состояние связи. */
import type { StepResult } from '../core/simulate';
import type { BreakReason } from '../core/routing';

/**
 * Цвета заданы литералами, а не CSS-переменными: SVG-атрибут fill не
 * поддерживает var() надёжно во всех браузерах.
 * Оранжевый — самая частая причина разрыва, остальные — ступени тёплого серого.
 */
export const ROUTE_OK = '#a0ca92';

export const REASON_COLOR: Record<BreakReason, string> = {
  no_visible_satellite: '#ee6018',
  isl_network_split: '#8a8380',
  no_gateway_contact: '#b8b3b0',
  gateway_unavailable: '#4d4947',
};

interface Props {
  steps: StepResult[];
  cursor: number;
  onSeek?: (index: number) => void;
}

export default function AvailabilityStrip({ steps, cursor, onSeek }: Props) {
  const n = steps.length;
  return (
    <svg
      className="strip"
      viewBox={`0 0 ${n} 10`}
      preserveAspectRatio="none"
      onClick={(e) => {
        if (!onSeek) return;
        const box = e.currentTarget.getBoundingClientRect();
        onSeek(Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - box.left) / box.width) * n))));
      }}
      style={{ cursor: onSeek ? 'pointer' : 'default' }}
    >
      {steps.map((s, i) => (
        <rect
          key={i}
          x={i}
          y={0}
          width={1}
          height={10}
          fill={s.path.length > 0 ? ROUTE_OK : REASON_COLOR[s.reason ?? 'no_visible_satellite']}
        />
      ))}
      <rect x={Math.max(0, cursor - 0.5)} y={0} width={1.5} height={10} fill="#fafafa" />
    </svg>
  );
}
