import { useMemo, useState } from 'react';
import { formatDurationMinutes } from '../lib/utbkLogic';
import type { StudyTimePeriodBucket } from '../types';

interface TryoutHistoryItem {
  id: number;
  package_id: number;
  package_title: string;
  utbk_score: number;
  completed_at: string;
}

interface TryoutScoreChartProps {
  history: TryoutHistoryItem[];
  selectedPackageId?: number | 'all';
  targetScore?: number;
}

export function TryoutScoreChart({ history, selectedPackageId = 'all', targetScore = 760 }: TryoutScoreChartProps) {
  const filtered = useMemo(() => {
    if (selectedPackageId === 'all') return history;
    return history.filter((h) => h.package_id === selectedPackageId);
  }, [history, selectedPackageId]);

  const width = 460;
  const height = 190;
  const padX = 36;
  const padY = 22;
  const minScore = 300;
  const maxScore = 1000;

  if (filtered.length === 0) {
    return (
      <div className="h-44 flex flex-col items-center justify-center text-center text-xs text-sky-100/80 px-4">
        <p className="font-semibold">Belum ada riwayat skor Try Out pada filter ini.</p>
        <p className="mt-1 opacity-75">Selesaikan satu paket Try Out untuk melihat grafik perkembangan skor.</p>
      </div>
    );
  }

  const points = filtered.map((item, i) => {
    const x =
      filtered.length === 1
        ? width / 2
        : padX + (i / (filtered.length - 1)) * (width - padX * 2);
    const clamped = Math.max(minScore, Math.min(maxScore, item.utbk_score));
    const y = height - padY - ((clamped - minScore) / (maxScore - minScore)) * (height - padY * 2);
    return { x, y, score: item.utbk_score, label: item.package_title };
  });

  const polylinePoints = points.map((p) => `${p.x},${p.y}`).join(' ');
  const targetY = height - padY - ((Math.max(minScore, Math.min(maxScore, targetScore)) - minScore) / (maxScore - minScore)) * (height - padY * 2);

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-44 overflow-visible" role="img" aria-label="Grafik perkembangan skor Try Out">
        {/* Grid lines */}
        {[400, 600, 800, 1000].map((val) => {
          const gy = height - padY - ((val - minScore) / (maxScore - minScore)) * (height - padY * 2);
          return (
            <g key={val}>
              <line x1={padX} y1={gy} x2={width - padX} y2={gy} stroke="rgba(255,255,255,0.16)" strokeDasharray="3 3" />
              <text x={4} y={gy + 4} fill="rgba(255,255,255,0.65)" fontSize="10" className="font-mono-num">
                {val}
              </text>
            </g>
          );
        })}

        {/* Target score line */}
        <line x1={padX} y1={targetY} x2={width - padX} y2={targetY} stroke="#D5BF50" strokeWidth="1.5" strokeDasharray="5 4" />
        <rect x={padX + 2} y={targetY - 15} width="64" height="13" rx="3" fill="#101B45" fillOpacity="0.88" />
        <text x={padX + 6} y={targetY - 5} textAnchor="start" fill="#D5BF50" fontSize="9.5" fontWeight="700">
          Target {targetScore}
        </text>

        {/* Line path */}
        {points.length > 1 && (
          <polyline fill="none" stroke="#D5BF50" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" points={polylinePoints} />
        )}

        {/* Data points */}
        {points.map((p, idx) => (
          <g key={idx}>
            <circle cx={p.x} cy={p.y} r="5.5" fill="#101B45" stroke="#D5BF50" strokeWidth="2.5" />
            <text x={p.x} y={p.y - 10} textAnchor="middle" fill="#FFFFFF" fontSize="11" fontWeight="700" className="font-mono-num">
              {p.score}
            </text>
            <text x={p.x} y={height - 4} textAnchor="middle" fill="rgba(255,255,255,0.75)" fontSize="9">
              {p.label.length > 14 ? `${p.label.slice(0, 13)}…` : p.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

interface SubtestMasteryChartProps {
  items: Array<{ subtest: string; percentage: number | null }>;
}

export function SubtestMasteryChart({ items }: SubtestMasteryChartProps) {
  return (
    <div className="space-y-2.5 w-full">
      {items.map((item) => {
        const pct = item.percentage ?? 0;
        return (
          <div key={item.subtest} className="space-y-1">
            <div className="flex items-center justify-between text-xs text-white/90">
              <span className="truncate pr-2 font-medium">{item.subtest}</span>
              <span className="font-mono-num font-bold text-[#D5BF50]">
                {item.percentage !== null ? `${pct}%` : '—'}
              </span>
            </div>
            <div className="h-2.5 w-full rounded-full bg-[#101B45]/70 overflow-hidden">
              <div
                className="h-full rounded-full bg-[#D5BF50] transition-all duration-300"
                style={{ width: `${item.percentage !== null ? pct : 0}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface StudyTimeChartProps {
  buckets: StudyTimePeriodBucket[];
  view: 'daily' | 'weekly' | 'monthly';
}

export function StudyTimeChart({ buckets, view }: StudyTimeChartProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const hasData = buckets.some((b) => b.totalMinutes > 0);

  if (!hasData) {
    return (
      <div className="h-44 flex flex-col items-center justify-center text-center text-xs text-sky-100/80 px-4">
        <p className="font-semibold">Belum ada catatan waktu belajar pada periode ini.</p>
        <p className="mt-1 opacity-75">
          Catat sesi belajar harian Anda di samping untuk memantau konsistensi belajar UTBK.
        </p>
      </div>
    );
  }

  const maxMinutes = Math.max(60, ...buckets.map((b) => b.totalMinutes));
  const width = 560;
  const height = 190;
  const padX = 42;
  const padY = 24;
  const chartW = width - padX * 2;
  const chartH = height - padY * 2;
  const slotW = chartW / Math.max(1, buckets.length);
  const barW = Math.min(28, Math.max(10, slotW * 0.6));

  return (
    <div className="w-full space-y-2">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-44 overflow-visible"
        role="img"
        aria-label={`Grafik waktu belajar (${view})`}
      >
        {[0, 0.5, 1].map((frac) => {
          const valMin = Math.round(maxMinutes * frac);
          const gy = height - padY - frac * chartH;
          return (
            <g key={frac}>
              <line x1={padX} y1={gy} x2={width - padX} y2={gy} stroke="rgba(255,255,255,0.14)" strokeDasharray="3 3" />
              <text x={4} y={gy + 4} fill="rgba(255,255,255,0.65)" fontSize="9.5" className="font-mono-num">
                {valMin >= 60 ? `${(valMin / 60).toFixed(1).replace(/\.0$/, '')}j` : `${valMin}m`}
              </text>
            </g>
          );
        })}

        {buckets.map((bucket, idx) => {
          const barH = (bucket.totalMinutes / maxMinutes) * chartH;
          const x = padX + idx * slotW + (slotW - barW) / 2;
          const y = height - padY - barH;
          const isHover = hoverIdx === idx;
          const showLabel = buckets.length <= 8 || idx % 2 === 0 || idx === buckets.length - 1;
          return (
            <g
              key={bucket.key}
              onMouseEnter={() => setHoverIdx(idx)}
              onMouseLeave={() => setHoverIdx(null)}
              className="cursor-pointer"
            >
              <rect
                x={x}
                y={bucket.totalMinutes > 0 ? Math.min(y, height - padY - 4) : height - padY - 2}
                width={barW}
                height={bucket.totalMinutes > 0 ? Math.max(4, barH) : 2}
                rx={4}
                fill={isHover ? '#FDE047' : bucket.totalMinutes > 0 ? '#D5BF50' : 'rgba(255,255,255,0.18)'}
              />
              {isHover && (
                <g>
                  <rect
                    x={Math.max(4, Math.min(width - 110, x + barW / 2 - 55))}
                    y={Math.max(2, y - 26)}
                    width="110"
                    height="20"
                    rx="4"
                    fill="#0B1434"
                    stroke="#D5BF50"
                    strokeWidth="1"
                  />
                  <text
                    x={Math.max(59, Math.min(width - 55, x + barW / 2))}
                    y={Math.max(15, y - 13)}
                    textAnchor="middle"
                    fill="#FFFFFF"
                    fontSize="9.5"
                    fontWeight="700"
                    className="font-mono-num"
                  >
                    {bucket.label}: {formatDurationMinutes(bucket.totalMinutes)}
                  </text>
                </g>
              )}
              {showLabel && (
                <text
                  x={x + barW / 2}
                  y={height - 6}
                  textAnchor="middle"
                  fill="rgba(255,255,255,0.75)"
                  fontSize="8.5"
                  className="font-mono-num"
                >
                  {bucket.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
