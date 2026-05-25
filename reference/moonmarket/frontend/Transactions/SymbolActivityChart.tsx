import {
    Card,
    CardContent,
    CardHeader
  } from "@/components/ui/card";
  import React, { useMemo } from "react";
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { ProcessedTrade } from "./Transactions";

export const SymbolActivityChart: React.FC<{ trades: ProcessedTrade[] }> = ({
    trades,
  }) => {
    const data = useMemo(
      () =>
        Object.entries(
          trades.reduce<Record<string, number>>(
            (acc, t) => ({ ...acc, [t.symbol]: (acc[t.symbol] || 0) + 1 }),
            {}
          )
        ).map(([name, value]) => ({ name, value })),
      [trades]
    );
    const COLORS = ["#0088FE", "#00C49F", "#FFBB28", "#FF8042", "#8884d8"];
  
    return (
      <Card className="lg:col-span-2">
        <CardHeader>
          <h3 className="text-lg font-semibold">Activity by Symbol</h3>
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
              <Tooltip formatter={(v) => `${v} trades`} />
              <Legend iconSize={10} />
            </PieChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    );
  };