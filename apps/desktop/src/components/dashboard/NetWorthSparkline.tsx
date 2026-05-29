import { LineChart, Line, ResponsiveContainer } from "recharts";
import type { NetWorthSnapshotSummary } from "@/lib/types";

interface NetWorthSparklineProps {
  snapshots: NetWorthSnapshotSummary[];
}

export function NetWorthSparkline({ snapshots }: NetWorthSparklineProps) {
  if (snapshots.length < 2) return null;

  const first = snapshots[0].total_cents;
  const last = snapshots[snapshots.length - 1].total_cents;
  const trendingUp = last >= first;

  const data = snapshots.map((s) => ({ value: s.total_cents }));

  return (
    <div className="h-12 w-full" data-testid="net-worth-sparkline">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <Line
            type="monotone"
            dataKey="value"
            stroke={trendingUp ? "#0d9488" : "#e11d48"}
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
