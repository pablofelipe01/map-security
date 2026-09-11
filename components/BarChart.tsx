"use client";

import { useState } from "react";

export interface Bar {
  /** "YYYY-MM-DD" */
  date: string;
  value: number;
}

interface Props {
  bars: Bar[];
  color: string;
  unit: string;
  /** Decimales del tooltip. */
  digits?: number;
}

const W = 560;
const H = 150;
const PAD = { l: 8, r: 8, t: 12, b: 22 };

/**
 * Gráfica de barras del patrón: una serie, eje de días, tooltip al pasar.
 *
 * Se dibuja en SVG a mano y no con una librería de charts porque es una sola
 * serie de 14 valores: cualquier librería pesaría más que el gráfico.
 *
 * Un día sin datos se dibuja como barra de altura cero y conserva su lugar en
 * el eje: el hueco es información (ese día la máquina no reportó), y comprimir
 * los días haría que el eje mintiera.
 */
export default function BarChart({ bars, color, unit, digits = 1 }: Props) {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(
    null
  );

  const max = Math.max(...bars.map((b) => b.value), 1);
  const bw = (W - PAD.l - PAD.r) / Math.max(bars.length, 1);

  return (
    <div className="relative">
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          preserveAspectRatio="xMidYMid meet"
          className="min-w-[420px]"
          role="img"
          aria-label={`Serie diaria en ${unit}`}
        >
          <line
            x1={PAD.l}
            y1={H - PAD.b}
            x2={W - PAD.r}
            y2={H - PAD.b}
            stroke="var(--border)"
            strokeWidth="1"
          />
          {bars.map((b, i) => {
            const h =
              b.value > 0
                ? Math.max((b.value / max) * (H - PAD.t - PAD.b), 3)
                : 0;
            const x = PAD.l + i * bw + bw * 0.15;
            const y = H - PAD.b - h;
            return (
              <g key={b.date}>
                {h > 0 && (
                  <rect
                    x={x}
                    y={y}
                    width={bw * 0.7}
                    height={h}
                    rx={4}
                    fill={color}
                    className="transition-[filter] hover:brightness-110"
                    onMouseMove={(e) => {
                      const r = (
                        e.currentTarget.ownerSVGElement as SVGSVGElement
                      ).getBoundingClientRect();
                      setTip({
                        x: e.clientX - r.left,
                        y: e.clientY - r.top,
                        text: `${b.date} · ${b.value.toFixed(digits)} ${unit}`,
                      });
                    }}
                    onMouseLeave={() => setTip(null)}
                  />
                )}
                <text
                  x={x + bw * 0.35}
                  y={H - 7}
                  textAnchor="middle"
                  className="fill-ink-3 font-mono text-[9px]"
                >
                  {b.date.slice(8)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {tip && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[110%] whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 font-mono text-[11px] text-white"
          style={{ left: tip.x, top: tip.y }}
        >
          {tip.text}
        </div>
      )}
    </div>
  );
}
