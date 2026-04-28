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
  Legend,
} from "recharts";
import { Card } from "@/components/ui/card";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  getClimateRegions,
  getClimateMonthly,
  type ClimateMonthlyRow,
} from "@/lib/api";
import { CHART_GRID_STROKE, semantic } from "@/lib/design-tokens";

export default function ClimateAnalysisPage() {
  const [regions, setRegions] = useState<string[]>([]);
  const [region, setRegion] = useState<string>("Ashanti");
  const [rows, setRows] = useState<ClimateMonthlyRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getClimateRegions().then((r) => {
      setRegions(r);
      if (r.length > 0 && !r.includes(region)) setRegion(r[0]);
    });
  }, []);

  useEffect(() => {
    if (!region) return;
    setLoading(true);
    getClimateMonthly({ region, limit: 5000 })
      .then((res) => setRows(res.data))
      .finally(() => setLoading(false));
  }, [region]);

  const series = useMemo(
    () =>
      rows
        .map((r) => ({
          date: `${r.year}-${String(r.month).padStart(2, "0")}`,
          year: r.year,
          month: r.month,
          t2m: r.t2m,
          t2m_max: r.t2m_max,
          t2m_min: r.t2m_min,
          precip: r.total_precip_mm,
          rainy_days: r.rainy_days,
          ndvi: r.ndvi,
          evi: r.evi,
          rh2m: r.rh2m,
        }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    [rows],
  );

  const xInterval = Math.max(0, Math.floor(series.length / 12));

  // Per-year aggregates (means for temp / NDVI, sums for rainfall / rainy days)
  // — used for the latest-year stat cards and YoY deltas.
  const yearlyStats = useMemo(() => {
    const buckets: Record<number, { tSum: number; tCount: number; precip: number; rainy: number; ndviSum: number; ndviCount: number }> = {};
    for (const r of rows) {
      const b = (buckets[r.year] ??= { tSum: 0, tCount: 0, precip: 0, rainy: 0, ndviSum: 0, ndviCount: 0 });
      if (r.t2m != null) { b.tSum += r.t2m; b.tCount += 1; }
      if (r.total_precip_mm != null) b.precip += r.total_precip_mm;
      if (r.rainy_days != null) b.rainy += r.rainy_days;
      if (r.ndvi != null) { b.ndviSum += r.ndvi; b.ndviCount += 1; }
    }
    return Object.entries(buckets)
      .map(([year, b]) => ({
        year: Number(year),
        avgTemp: b.tCount ? b.tSum / b.tCount : null,
        totalPrecip: b.precip,
        rainyDays: b.rainy,
        avgNdvi: b.ndviCount ? b.ndviSum / b.ndviCount : null,
      }))
      .sort((a, b) => a.year - b.year);
  }, [rows]);

  const latest = yearlyStats.at(-1);
  const prev = yearlyStats.at(-2);

  const delta = (curr: number | null | undefined, prior: number | null | undefined) => {
    if (curr == null || prior == null || prior === 0) return null;
    return ((curr - prior) / prior) * 100;
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page header */}
      <div className="flex items-end justify-between gap-4 flex-wrap pb-4 border-b border-border">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            Analysis
          </div>
          <h1 className="text-2xl font-bold text-foreground leading-tight">
            Climate Trends
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            Visual analysis of NASA POWER + MODIS climate predictors. Select a region to update all
            panels. Raw data lives under{" "}
            <span className="font-semibold text-foreground">Datasets → Climate</span>.
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

      {/* Stat cards: latest year + YoY delta against prior year */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Avg temperature"
          value={latest?.avgTemp != null ? `${latest.avgTemp.toFixed(1)}°C` : "—"}
          delta={delta(latest?.avgTemp, prev?.avgTemp)}
          sub={latest ? `${latest.year} · ${region}` : "—"}
        />
        <StatCard
          label="Total rainfall"
          value={latest ? `${latest.totalPrecip.toFixed(0)} mm` : "—"}
          delta={delta(latest?.totalPrecip, prev?.totalPrecip)}
          sub={latest ? `${latest.year} · ${region}` : "—"}
        />
        <StatCard
          label="Avg NDVI"
          value={latest?.avgNdvi != null ? latest.avgNdvi.toFixed(0) : "—"}
          delta={delta(latest?.avgNdvi, prev?.avgNdvi)}
          sub={latest ? `${latest.year} · MODIS` : "—"}
        />
        <StatCard
          label="Rainy days"
          value={latest ? latest.rainyDays.toFixed(0) : "—"}
          delta={delta(latest?.rainyDays, prev?.rainyDays)}
          sub={latest ? `${latest.year} total` : "—"}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Temperature (°C)" subtitle={`T2M monthly mean / max / min · ${region}`}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 9 }} interval={xInterval} />
              <YAxis tick={{ fontSize: 9 }} width={35} tickMargin={2} />
              <Tooltip contentStyle={{ fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Line type="monotone" dataKey="t2m" stroke={semantic.up} strokeWidth={1.5} dot={false} name="Mean" />
              <Line type="monotone" dataKey="t2m_max" stroke={semantic.cpi} strokeWidth={1} dot={false} name="Max" strokeDasharray="3 3" />
              <Line type="monotone" dataKey="t2m_min" stroke={semantic.imports} strokeWidth={1} dot={false} name="Min" strokeDasharray="3 3" />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Precipitation (mm)" subtitle={`Monthly total + rainy days · ${region}`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={series} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 9 }} interval={xInterval} />
              <YAxis yAxisId="left" tick={{ fontSize: 9 }} width={35} tickMargin={2} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 9 }} width={30} tickMargin={2} />
              <Tooltip contentStyle={{ fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar yAxisId="left" dataKey="precip" fill={semantic.exports} name="Precip (mm)" />
              <Bar yAxisId="right" dataKey="rainy_days" fill={semantic.imports} name="Rainy days" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Vegetation indices" subtitle={`NDVI / EVI from MODIS · ${region}`}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 9 }} interval={xInterval} />
              <YAxis tick={{ fontSize: 9 }} width={35} tickMargin={2} />
              <Tooltip contentStyle={{ fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Line type="monotone" dataKey="ndvi" stroke={semantic.up} strokeWidth={1.5} dot={false} name="NDVI" />
              <Line type="monotone" dataKey="evi" stroke={semantic.exports} strokeWidth={1.5} dot={false} name="EVI" />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Relative humidity (%)" subtitle={`RH2M · ${region}`}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 9 }} interval={xInterval} />
              <YAxis tick={{ fontSize: 9 }} width={35} tickMargin={2} />
              <Tooltip contentStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="rh2m" stroke={semantic.up} strokeWidth={1.5} dot={false} name="RH %" />
            </LineChart>
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
  sub,
}: {
  label: string;
  value: string;
  delta: number | null;
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
      : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}% YoY`;
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
