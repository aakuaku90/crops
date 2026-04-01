"use client";

import { useState, useEffect } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Skeleton } from "@/components/ui/skeleton";
import { getPriceTimeseries, getCommodities, type TimeseriesPoint, type Commodity } from "@/lib/api";
import { format } from "date-fns";

const COLORS = ["#16a34a", "#2563eb", "#dc2626", "#d97706", "#7c3aed", "#0891b2"];

export function PriceLineChart() {
  const [commodities, setCommodities] = useState<Commodity[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [data, setData] = useState<TimeseriesPoint[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getCommodities().then((c) => {
      const unique = c.filter((item, idx, arr) => arr.findIndex((x) => x.name === item.name) === idx);
      setCommodities(unique);
      if (unique.length > 0) setSelected(unique[0].name);
    });
  }, []);

  useEffect(() => {
    if (!selected) return;
    setLoading(true);
    getPriceTimeseries(selected)
      .then(setData)
      .finally(() => setLoading(false));
  }, [selected]);

  const currency = data[0]?.currency || "GHS";
  const unit = data[0]?.unit || "";

  // Group by market for multi-line
  const markets = [...new Set(data.map((d) => d.market_name))].slice(0, 6);
  const byDate: Record<string, Record<string, number>> = {};
  data.forEach((d) => {
    if (!byDate[d.date]) byDate[d.date] = {};
    byDate[d.date][d.market_name] = Number(d.avg_price);
  });

  const multiData = Object.entries(byDate)
    .map(([date, markets]) => ({ date, ...markets }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <CardTitle>Price Trends</CardTitle>
            <CardDescription>Monthly average price by market ({currency})</CardDescription>
          </div>
          <SearchableSelect
            className="w-48"
            value={selected}
            onValueChange={setSelected}
            placeholder="Select commodity"
            options={commodities.map((c) => ({ value: c.name, label: c.name }))}
          />
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-72 w-full" />
        ) : multiData.length === 0 ? (
          <div className="h-72 flex items-center justify-center text-muted-foreground text-sm">
            No data available. Trigger a sync to load data.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={multiData} margin={{ top: 5, right: 20, left: -20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11 }}
                interval={11}
                tickFormatter={(v) => {
                  try { return format(new Date(v), "MMM yy"); } catch { return v; }
                }}
              />
              <YAxis
                tick={{ fontSize: 11 }}
                tickFormatter={(v) => `${v}`}
              />
              <Tooltip
                formatter={(value: number) => [`${currency} ${value.toFixed(2)} / ${unit}`, ""]}
                labelFormatter={(label) => {
                  try { return format(new Date(label), "MMMM yyyy"); } catch { return label; }
                }}
              />
              <Legend />
              {markets.map((market, i) => (
                <Line
                  key={market}
                  type="monotone"
                  dataKey={market}
                  stroke={COLORS[i % COLORS.length]}
                  dot={false}
                  strokeWidth={2}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
