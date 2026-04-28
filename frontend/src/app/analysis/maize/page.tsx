"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  Line,
  LineChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card } from "@/components/ui/card";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  getMofaRegionalRegions,
  getMofaRegionalMaize,
  type MofaRegionalMaizeRow,
} from "@/lib/api";
import { CHART_GRID_STROKE, semantic } from "@/lib/design-tokens";

function formatTonnes(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toFixed(0);
}

export default function MaizeAnalysisPage() {
  const [regions, setRegions] = useState<string[]>([]);
  const [region, setRegion] = useState<string>("Ashanti");
  const [allRows, setAllRows] = useState<MofaRegionalMaizeRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([getMofaRegionalRegions(), getMofaRegionalMaize({ limit: 5000 })])
      .then(([r, all]) => {
        setRegions(r);
        if (r.length > 0 && !r.includes(region)) setRegion(r[0]);
        setAllRows(all.data);
      })
      .finally(() => setLoading(false));
  }, []);

  // Per-region time series, sorted ascending by year for chart readability.
  const regionRows = useMemo(
    () =>
      [...allRows]
        .filter((r) => r.region === region)
        .sort((a, b) => a.year - b.year),
    [allRows, region],
  );

  // Stats for the selected region — latest year, YoY delta, and a 5-year baseline.
  const latest = regionRows.at(-1);
  const prev = regionRows.at(-2);
  const fiveYearAvgYield = (() => {
    const recent = regionRows.slice(-6, -1).filter((r) => r.avg_yield_mt_ha != null);
    if (recent.length === 0) return null;
    return recent.reduce((s, r) => s + (r.avg_yield_mt_ha ?? 0), 0) / recent.length;
  })();
  const delta = (curr: number | null | undefined, prior: number | null | undefined) => {
    if (curr == null || prior == null || prior === 0) return null;
    return ((curr - prior) / prior) * 100;
  };

  // Latest-year ranking across all regions, sorted by yield descending.
  const latestYear = allRows.length ? Math.max(...allRows.map((r) => r.year)) : null;
  const ranking = useMemo(
    () =>
      latestYear
        ? allRows
            .filter((r) => r.year === latestYear && r.avg_yield_mt_ha != null)
            .sort((a, b) => (b.avg_yield_mt_ha ?? 0) - (a.avg_yield_mt_ha ?? 0))
        : [],
    [allRows, latestYear],
  );

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page header */}
      <div className="flex items-end justify-between gap-4 flex-wrap pb-4 border-b border-border">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            Analysis
          </div>
          <h1 className="text-2xl font-bold text-foreground leading-tight">
            Maize Trends
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            Visual analysis of MOFA regional maize statistics, 1999 to 2023: yield, production,
            area, and the latest-year regional ranking. Raw data lives under{" "}
            <span className="font-semibold text-foreground">Datasets → MOFA Maize Regional</span>.
          </p>
        </div>
        <SearchableSelect
          options={regions.map((r) => ({ value: r, label: r }))}
          value={region}
          onValueChange={setRegion}
          placeholder="Select region"
          className="w-48"
        />
      </div>

      {/* Stat cards: latest year + YoY delta */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Yield"
          value={latest?.avg_yield_mt_ha != null ? `${latest.avg_yield_mt_ha.toFixed(2)} mt/ha` : "—"}
          delta={delta(latest?.avg_yield_mt_ha, prev?.avg_yield_mt_ha)}
          sub={latest ? `${latest.year} · ${region}` : "—"}
        />
        <StatCard
          label="Production"
          value={latest ? `${formatTonnes(latest.total_production_mt)} mt` : "—"}
          delta={delta(latest?.total_production_mt, prev?.total_production_mt)}
          sub={latest ? `${latest.year} · ${region}` : "—"}
        />
        <StatCard
          label="Area"
          value={latest ? `${formatTonnes(latest.total_area_ha)} ha` : "—"}
          delta={delta(latest?.total_area_ha, prev?.total_area_ha)}
          sub={latest ? `${latest.year} · ${region}` : "—"}
        />
        <StatCard
          label="5-yr avg yield"
          value={fiveYearAvgYield != null ? `${fiveYearAvgYield.toFixed(2)} mt/ha` : "—"}
          delta={delta(latest?.avg_yield_mt_ha, fiveYearAvgYield)}
          deltaSuffix="vs avg"
          sub="Baseline · prior 5 years"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Yield over time" subtitle={`mt/ha · ${region}`}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={regionRows} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} vertical={false} />
              <XAxis dataKey="year" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} width={35} tickMargin={2} />
              <Tooltip
                contentStyle={{ fontSize: 11 }}
                formatter={(v: number) => [`${v.toFixed(2)} mt/ha`, "Yield"]}
              />
              <Line
                type="monotone"
                dataKey="avg_yield_mt_ha"
                stroke={semantic.production}
                strokeWidth={2}
                dot={{ r: 2 }}
                name="Yield"
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Production over time" subtitle={`mt · ${region}`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={regionRows} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} vertical={false} />
              <XAxis dataKey="year" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={formatTonnes} width={35} tickMargin={2} />
              <Tooltip
                contentStyle={{ fontSize: 11 }}
                formatter={(v: number) => [`${formatTonnes(v)} mt`, "Production"]}
              />
              <Bar dataKey="total_production_mt" fill={semantic.exports} name="Production" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Area cultivated" subtitle={`ha · ${region}`}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={regionRows} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} vertical={false} />
              <XAxis dataKey="year" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={formatTonnes} width={35} tickMargin={2} />
              <Tooltip
                contentStyle={{ fontSize: 11 }}
                formatter={(v: number) => [`${formatTonnes(v)} ha`, "Area"]}
              />
              <Line
                type="monotone"
                dataKey="total_area_ha"
                stroke={semantic.area}
                strokeWidth={2}
                dot={{ r: 2 }}
                name="Area"
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title={`Regional ranking · ${latestYear ?? "—"}`}
          subtitle="Yield mt/ha, all regions"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={ranking} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10 }} tickMargin={2} />
              <YAxis type="category" dataKey="region" tick={{ fontSize: 8 }} width={62} tickMargin={1} interval={0} />
              <Tooltip
                contentStyle={{ fontSize: 11 }}
                formatter={(v: number) => [`${v.toFixed(2)} mt/ha`, "Yield"]}
              />
              <Bar dataKey="avg_yield_mt_ha" fill={semantic.production} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  );
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <span className="text-[10px] text-muted-foreground">{subtitle}</span>
      </div>
      <div className="h-64">{children}</div>
    </Card>
  );
}

function StatCard({
  label,
  value,
  delta,
  deltaSuffix = "YoY",
  sub,
}: {
  label: string;
  value: string;
  delta: number | null;
  deltaSuffix?: string;
  sub: string;
}) {
  const deltaClass =
    delta == null
      ? "text-muted-foreground"
      : delta >= 0
        ? "text-success"
        : "text-destructive";
  const deltaText =
    delta == null
      ? "—"
      : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}% ${deltaSuffix}`;
  return (
    <Card className="p-4">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        {label}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold tabular-nums text-foreground">{value}</span>
        <span className={`text-[11px] font-medium ${deltaClass}`}>{deltaText}</span>
      </div>
      <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>
    </Card>
  );
}
