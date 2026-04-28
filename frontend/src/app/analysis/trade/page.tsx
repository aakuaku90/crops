"use client";

import { useEffect, useState } from "react";
import {
  BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getFaoTrade, type FaoTrade } from "@/lib/api";
import { CHART_GRID_STROKE, semantic } from "@/lib/design-tokens";
import { fmtNum, Empty, useCropSelection, CropSelect, PageHeader } from "../_shared";

export default function TradePage() {
  const { crops, crop, setCrop } = useCropSelection();

  const [trade, setTrade] = useState<FaoTrade[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!crop) return;
    setLoading(true);
    getFaoTrade(crop, undefined, 1000, 0).then((tr) => {
      setTrade(tr.data);
      setLoading(false);
    });
  }, [crop]);

  const tradeTrend = (() => {
    const byYear: Record<number, { year: number; imports?: number; exports?: number }> = {};
    for (const d of trade) {
      if (!byYear[d.year]) byYear[d.year] = { year: d.year };
      const el = d.element?.toLowerCase();
      if (el === "import quantity") byYear[d.year].imports = (byYear[d.year].imports ?? 0) + d.value;
      else if (el === "export quantity") byYear[d.year].exports = (byYear[d.year].exports ?? 0) + d.value;
    }
    return Object.values(byYear).sort((a, b) => a.year - b.year);
  })();

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Trade"
        description="Import and export volumes per crop. Rising imports without matching exports signal a domestic supply gap."
        right={<CropSelect crops={crops} crop={crop} onChange={setCrop} />}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Import vs Export Volume</CardTitle>
          <CardDescription>Tonnes. FAO Trade.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-56 w-full" /> : tradeTrend.length === 0 ? (
            <Empty message="No data. Sync FAO Trade." height={200} />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={tradeTrend} margin={{ top: 4, right: 16, left: -16, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => fmtNum(v)} />
                <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number, n: string) => [`${fmtNum(v)} t`, n]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="imports" name="Imports" fill={semantic.imports} radius={[4, 4, 0, 0]} />
                <Bar dataKey="exports" name="Exports" fill={semantic.exports} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
