import React from "react";
import { fmt, ProcessedTrade } from "./Transactions";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

export const VolumeBySymbolChart: React.FC<{ trades: ProcessedTrade[] }> = ({
  trades,
}) => {
  const data = React.useMemo(() => {
    const vol: Record<string, number> = {};
    trades.forEach((t) => {
      vol[t.symbol] = (vol[t.symbol] || 0) + Math.abs(t.netAmount);
    });
    return Object.entries(vol).map(([name, value]) => ({ name, value }));
  }, [trades]);

  const COLORS = ["#6366f1", "#10b981", "#fbbf24", "#ef4444", "#8b5cf6"];

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <h3 className="text-lg font-semibold">Activity by Volume</h3>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              outerRadius={80}
              dataKey="value"
              labelLine={false}
              label={({ name, percent }) =>
                `${name} ${(percent * 100).toFixed(0)}%`
              }
            >
              {data.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(v) => fmt(v as number)} />
            <Legend iconSize={10} />
          </PieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
};
