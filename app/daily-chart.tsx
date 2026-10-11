"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCompact, formatRupiah } from "@/lib/format";

type Point = { day: number; label: string; total: number };

export function DailyChart({ data }: { data: Point[] }) {
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis
            dataKey="day"
            tickLine={false}
            axisLine={{ stroke: "var(--axis)" }}
            tick={{ fill: "var(--text-muted)", fontSize: 12 }}
            interval="preserveStartEnd"
            minTickGap={16}
          />
          <YAxis
            width={44}
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--text-muted)", fontSize: 12 }}
            tickFormatter={formatCompact}
          />
          <Tooltip
            cursor={{ fill: "var(--series-1-wash)" }}
            content={({ active, payload }) => {
              const point = payload?.[0]?.payload as Point | undefined;
              if (!active || !point) return null;
              return (
                <div className="card px-3 py-2 text-sm shadow-sm">
                  <div className="text-(--text-secondary)">{point.label}</div>
                  <div className="font-semibold">
                    {formatRupiah(point.total)}
                  </div>
                </div>
              );
            }}
          />
          <Bar
            dataKey="total"
            fill="var(--series-1)"
            radius={[4, 4, 0, 0]}
            maxBarSize={24}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
