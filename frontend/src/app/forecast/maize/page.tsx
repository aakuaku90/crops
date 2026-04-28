"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  Area, AreaChart,
  Bar, BarChart,
  Line, LineChart,
  ReferenceArea, ReferenceLine,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  getMaizePredictions,
  getMaizePredictionsRegions,
  getMaizePredictionsSummary,
  syncMaizePredictions,
  type MaizePredictionRow,
  type MaizePredictionsSummary,
} from "@/lib/api";
import { CHART_GRID_STROKE, semantic } from "@/lib/design-tokens";

const ALL = "All regions";

function fmt(v: number | null | undefined, digits = 2): string {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toLocaleString(undefined, { maximumFractionDigits: digits });
}

interface TrajectoryPoint {
  year: number;
  actual: number | null;
  forecast: number | null;
}

export default function MaizeForecastPage() {
  const [regions, setRegions] = useState<string[]>([]);
  const [region, setRegion] = useState<string>(ALL);
  const [allRows, setAllRows] = useState<MaizePredictionRow[]>([]);
  const [summary, setSummary] = useState<MaizePredictionsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    const [r, list, s] = await Promise.all([
      getMaizePredictionsRegions(),
      getMaizePredictions({ limit: 5000 }),
      getMaizePredictionsSummary(),
    ]);
    setRegions(r);
    setAllRows(list.data);
    setSummary(s);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleSync() {
    setSyncing(true);
    setSyncMsg(null);
    const res = await syncMaizePredictions((e) => {
      setSyncMsg(e.message ?? `${e.stage} ${e.pct}%`);
    });
    setSyncMsg(res.message);
    setSyncing(false);
    refresh();
  }

  const isAll = region === ALL;

  const futureRows = useMemo(
    () => allRows.filter((r) => r.source === "future_tabpfn"),
    [allRows],
  );
  const backtestRows = useMemo(
    () => allRows.filter((r) => r.source === "backtest"),
    [allRows],
  );

  // Boundary year — last year with actuals, used to mark where forecast begins.
  const lastActualYear = useMemo(() => {
    const ys = backtestRows
      .filter((r) => r.actual_yield != null)
      .map((r) => r.year);
    return ys.length ? Math.max(...ys) : null;
  }, [backtestRows]);

  // Trajectory series: actual (history) + forecast (future). Filtered by region,
  // or aggregated as a national mean when "All regions" is selected.
  const trajectory = useMemo<TrajectoryPoint[]>(() => {
    if (isAll) {
      const byYear = new Map<number, { actualSum: number; actualN: number; forecastSum: number; forecastN: number }>();
      for (const r of backtestRows) {
        if (r.actual_yield == null) continue;
        const e = byYear.get(r.year) ?? { actualSum: 0, actualN: 0, forecastSum: 0, forecastN: 0 };
        e.actualSum += r.actual_yield;
        e.actualN += 1;
        byYear.set(r.year, e);
      }
      for (const r of futureRows) {
        if (r.pred_yield == null) continue;
        const e = byYear.get(r.year) ?? { actualSum: 0, actualN: 0, forecastSum: 0, forecastN: 0 };
        e.forecastSum += r.pred_yield;
        e.forecastN += 1;
        byYear.set(r.year, e);
      }
      return Array.from(byYear.entries())
        .map(([year, e]) => ({
          year,
          actual: e.actualN ? e.actualSum / e.actualN : null,
          forecast: e.forecastN ? e.forecastSum / e.forecastN : null,
        }))
        .sort((a, b) => a.year - b.year);
    }

    const byYear = new Map<number, TrajectoryPoint>();
    for (const r of backtestRows.filter((x) => x.region === region)) {
      const e = byYear.get(r.year) ?? { year: r.year, actual: null, forecast: null };
      if (r.actual_yield != null) e.actual = r.actual_yield;
      byYear.set(r.year, e);
    }
    for (const r of futureRows.filter((x) => x.region === region)) {
      const e = byYear.get(r.year) ?? { year: r.year, actual: null, forecast: null };
      if (r.pred_yield != null) e.forecast = r.pred_yield;
      byYear.set(r.year, e);
    }
    return Array.from(byYear.values()).sort((a, b) => a.year - b.year);
  }, [backtestRows, futureRows, region, isAll]);

  // Bridge actual → forecast: copy the last actual into the first forecast row's
  // `actual` slot so the two lines visually connect at the boundary year.
  const bridgedTrajectory = useMemo<TrajectoryPoint[]>(() => {
    if (lastActualYear == null) return trajectory;
    const out = trajectory.map((p) => ({ ...p }));
    const boundaryIdx = out.findIndex((p) => p.year === lastActualYear);
    const lastVal = boundaryIdx >= 0 ? out[boundaryIdx].actual : null;
    if (lastVal != null) {
      const firstForecastIdx = out.findIndex((p) => p.year > lastActualYear && p.forecast != null);
      if (firstForecastIdx >= 0 && out[firstForecastIdx].actual == null) {
        out[firstForecastIdx].actual = lastVal;
      }
      // Also seed the boundary with a forecast value to start the dashed line.
      if (boundaryIdx >= 0 && out[boundaryIdx].forecast == null) {
        out[boundaryIdx].forecast = lastVal;
      }
    }
    return out;
  }, [trajectory, lastActualYear]);

  const forecastYears = useMemo(() => {
    const ys = new Set(futureRows.map((r) => r.year));
    return Array.from(ys).sort((a, b) => a - b);
  }, [futureRows]);

  const forecastHorizon = forecastYears.length
    ? forecastYears[forecastYears.length - 1]
    : null;

  // Hero KPIs — averaged / summed across regions for the latest forecast year.
  const horizonRows = useMemo(
    () => (forecastHorizon ? futureRows.filter((r) => r.year === forecastHorizon) : []),
    [futureRows, forecastHorizon],
  );

  const horizonYieldAvg = useMemo(() => {
    const ys = horizonRows.map((r) => r.pred_yield).filter((v): v is number => v != null);
    if (!ys.length) return null;
    return ys.reduce((s, v) => s + v, 0) / ys.length;
  }, [horizonRows]);

  const horizonProductionTotal = useMemo(
    () => horizonRows.reduce((s, r) => s + (r.pred_production ?? 0), 0),
    [horizonRows],
  );

  // Latest-actual reference for YoY comparison in the table (per-region).
  const lastActualByRegion = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of backtestRows) {
      if (r.actual_yield == null) continue;
      if (lastActualYear != null && r.year === lastActualYear) {
        map.set(r.region, r.actual_yield);
      }
    }
    return map;
  }, [backtestRows, lastActualYear]);

  // Regional bar chart: actual (last reported year) vs projected (horizon year)
  // per region, sorted by projected yield descending so the strongest forecasts
  // sit on the left.
  const regionalForecast = useMemo(() => {
    return horizonRows
      .filter((r) => r.pred_yield != null)
      .map((r) => ({
        region: r.region,
        actual: lastActualByRegion.get(r.region) ?? null,
        forecast: r.pred_yield as number,
      }))
      .sort((a, b) => b.forecast - a.forecast);
  }, [horizonRows, lastActualByRegion]);

  // Table of forecast rows (filtered by region). Sorted region asc, year asc.
  const tableRows = useMemo(() => {
    const rows = isAll ? futureRows : futureRows.filter((r) => r.region === region);
    return [...rows].sort((a, b) =>
      a.region !== b.region ? a.region.localeCompare(b.region) : a.year - b.year,
    );
  }, [futureRows, region, isAll]);

  // Trajectory chart axis bounds — pad y a bit so the shaded forecast band
  // doesn't kiss the top edge of the plot.
  const yMax = useMemo(() => {
    const vals = bridgedTrajectory.flatMap((p) =>
      [p.actual, p.forecast].filter((v): v is number => v != null),
    );
    if (!vals.length) return 4;
    return Math.ceil(Math.max(...vals) * 1.15 * 10) / 10;
  }, [bridgedTrajectory]);

  const xMin = bridgedTrajectory[0]?.year;
  const xMax = bridgedTrajectory[bridgedTrajectory.length - 1]?.year;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page header — title + sync action only. Filter controls live below. */}
      <div className="flex items-end justify-between gap-4 flex-wrap pb-4 border-b border-border">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            Forecast
          </div>
          <h1 className="text-2xl font-bold text-foreground leading-tight">
            Maize Yield Forecast
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            12-month maize yield projections by region, generated by TabPFN.
          </p>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-2 bg-foreground text-background px-4 py-2 rounded-full text-sm font-medium hover:bg-foreground/90 disabled:opacity-70 disabled:cursor-not-allowed transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Syncing..." : "Sync forecast"}
        </button>
      </div>

      {/* Filter row */}
      <div className="flex items-center gap-2 flex-wrap">
        <SearchableSelect
          options={[
            { value: ALL, label: ALL },
            ...regions.map((r) => ({ value: r, label: r })),
          ]}
          value={region}
          onValueChange={setRegion}
          placeholder="Filter region"
          className="w-56"
        />
      </div>

      {syncMsg && <div className="text-xs text-muted-foreground">{syncMsg}</div>}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryTile
          label="Forecast horizon"
          value={forecastHorizon ?? "—"}
          sub={
            forecastYears.length
              ? `${forecastYears[0]}–${forecastYears[forecastYears.length - 1]}`
              : "No forecast rows"
          }
        />
        <SummaryTile
          label={`Projected yield (${forecastHorizon ?? "—"})`}
          value={horizonYieldAvg != null ? `${horizonYieldAvg.toFixed(2)} mt/ha` : "—"}
          sub={isAll ? "National mean across regions" : region}
        />
        <SummaryTile
          label={`Projected production (${forecastHorizon ?? "—"})`}
          value={horizonProductionTotal ? `${fmt(horizonProductionTotal, 0)} mt` : "—"}
          sub="Sum across forecasted regions"
        />
        <SummaryTile
          label="Regions covered"
          value={regions.length}
          sub={
            summary?.future_horizon_year
              ? `Through ${summary.future_horizon_year}`
              : "—"
          }
        />
      </div>

      {/* Hero — yield trajectory */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Yield Trajectory</CardTitle>
          <CardDescription>
            mt/ha · {isAll ? "national mean" : region}. Solid = MOFA actuals,
            dashed = TabPFN forecast. Shaded band marks years past the last reported year.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-72 w-full" />
          ) : bridgedTrajectory.length === 0 ? (
            <div className="h-72 flex items-center justify-center text-sm text-muted-foreground">
              No forecast data. Click <span className="font-semibold mx-1">Sync forecast</span> to ingest.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={bridgedTrajectory} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                <defs>
                  <linearGradient id="forecastBand" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={semantic.supply} stopOpacity={0.18} />
                    <stop offset="100%" stopColor={semantic.supply} stopOpacity={0.04} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                <XAxis dataKey="year" tick={{ fontSize: 10 }} tickMargin={2} />
                <YAxis
                  tick={{ fontSize: 10 }}
                  width={35}
                  tickMargin={2}
                  domain={[0, yMax]}
                  unit=""
                />
                <Tooltip
                  contentStyle={{ fontSize: 11 }}
                  formatter={(v: number, n: string) => [
                    v != null ? `${v.toFixed(2)} mt/ha` : "—",
                    n,
                  ]}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {lastActualYear != null && xMax != null && lastActualYear < xMax && (
                  <ReferenceArea
                    x1={lastActualYear}
                    x2={xMax}
                    y1={0}
                    y2={yMax}
                    fill="url(#forecastBand)"
                    stroke="none"
                  />
                )}
                {lastActualYear != null && xMin != null && lastActualYear >= xMin && (
                  <ReferenceLine
                    x={lastActualYear}
                    stroke={semantic.neutral}
                    strokeDasharray="3 3"
                    label={{
                      value: "Forecast →",
                      position: "insideTopRight",
                      fontSize: 10,
                      fill: semantic.neutral,
                    }}
                  />
                )}
                <Line
                  type="monotone"
                  dataKey="actual"
                  name="Actual (MOFA)"
                  stroke={semantic.production}
                  strokeWidth={2}
                  dot={{ r: 2 }}
                  connectNulls={false}
                />
                <Line
                  type="monotone"
                  dataKey="forecast"
                  name="Forecast (TabPFN)"
                  stroke={semantic.area}
                  strokeWidth={2}
                  strokeDasharray="5 3"
                  dot={{ r: 2 }}
                  connectNulls={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Regional breakdown — only meaningful when looking at all regions */}
      {isAll && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Projected Yield by Region{" "}
              {forecastHorizon ? `(${forecastHorizon})` : ""}
            </CardTitle>
            <CardDescription>
              Last reported actual ({lastActualYear ?? "—"}) vs TabPFN projection
              {forecastHorizon ? ` (${forecastHorizon})` : ""}, mt/ha per region. Sorted by projected yield, high to low.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-64 w-full" />
            ) : regionalForecast.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">
                No forecast rows for the horizon year.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={320}>
                <BarChart
                  data={regionalForecast}
                  margin={{ top: 4, right: 16, left: 0, bottom: 8 }}
                  barCategoryGap="20%"
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} vertical={false} />
                  <XAxis
                    type="category"
                    dataKey="region"
                    tick={{ fontSize: 10 }}
                    interval={0}
                    angle={-35}
                    textAnchor="end"
                    height={70}
                  />
                  <YAxis
                    type="number"
                    tick={{ fontSize: 10 }}
                    width={40}
                    tickFormatter={(v) => v.toFixed(1)}
                  />
                  <Tooltip
                    contentStyle={{ fontSize: 11 }}
                    formatter={(v: number, n: string) => [
                      v != null ? `${v.toFixed(2)} mt/ha` : "—",
                      n,
                    ]}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar
                    dataKey="actual"
                    name={`Actual (${lastActualYear ?? "—"})`}
                    fill={semantic.production}
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="forecast"
                    name={`Forecast (${forecastHorizon ?? "—"})`}
                    fill={semantic.area}
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      )}

      {/* Per-region production trajectory (only when a region is selected) */}
      {!isAll && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Projected Production · {region}</CardTitle>
            <CardDescription>
              Tonnes per year. Forecasted area × forecasted yield, model-internal.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-56 w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart
                  data={[...futureRows]
                    .filter((r) => r.region === region)
                    .map((r) => ({ year: r.year, production: r.pred_production }))
                    .sort((a, b) => a.year - b.year)}
                  margin={{ top: 4, right: 16, left: 0, bottom: 4 }}
                >
                  <defs>
                    <linearGradient id="prodGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={semantic.production} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={semantic.production} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                  <XAxis dataKey="year" tick={{ fontSize: 10 }} />
                  <YAxis
                    tick={{ fontSize: 10 }}
                    width={55}
                    tickFormatter={(v) => fmt(v, 0)}
                  />
                  <Tooltip
                    contentStyle={{ fontSize: 11 }}
                    formatter={(v: number) => [`${fmt(v, 0)} mt`, "Production"]}
                  />
                  <Area
                    type="monotone"
                    dataKey="production"
                    stroke={semantic.production}
                    strokeWidth={2}
                    fill="url(#prodGradient)"
                    dot={{ r: 3, fill: semantic.production, strokeWidth: 0 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      )}

      {/* Forecast detail table */}
      <Card className="p-0 overflow-hidden">
        {tableRows.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No forecast rows for this selection.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="text-left font-semibold uppercase tracking-wider px-3 py-2 whitespace-nowrap">Region</th>
                  <th className="text-left font-semibold uppercase tracking-wider px-3 py-2 whitespace-nowrap">Year</th>
                  <th className="text-right font-semibold uppercase tracking-wider px-3 py-2 whitespace-nowrap">Pred yield</th>
                  <th className="text-right font-semibold uppercase tracking-wider px-3 py-2 whitespace-nowrap">vs last actual</th>
                  <th className="text-right font-semibold uppercase tracking-wider px-3 py-2 whitespace-nowrap">Pred area</th>
                  <th className="text-right font-semibold uppercase tracking-wider px-3 py-2 whitespace-nowrap">Pred production</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map((r) => {
                  const last = lastActualByRegion.get(r.region);
                  const delta =
                    last != null && r.pred_yield != null && last !== 0
                      ? (r.pred_yield - last) / last
                      : null;
                  return (
                    <tr
                      key={`${r.region}-${r.year}`}
                      className="border-t border-border hover:bg-muted/30"
                    >
                      <td className="px-3 py-1.5">{r.region}</td>
                      <td className="px-3 py-1.5 tabular-nums">{r.year}</td>
                      <td className="px-3 py-1.5 tabular-nums text-right">{fmt(r.pred_yield)}</td>
                      <td
                        className={`px-3 py-1.5 tabular-nums text-right ${
                          delta == null
                            ? "text-muted-foreground"
                            : delta >= 0
                            ? "text-success"
                            : "text-destructive"
                        }`}
                      >
                        {delta == null
                          ? "—"
                          : `${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(1)}%`}
                      </td>
                      <td className="px-3 py-1.5 tabular-nums text-right">{fmt(r.pred_area, 0)}</td>
                      <td className="px-3 py-1.5 tabular-nums text-right">{fmt(r.pred_production, 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub: string;
}) {
  return (
    <Card className="p-4">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        {label}
      </div>
      <div className="text-2xl font-bold tabular-nums text-foreground">
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
      <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>
    </Card>
  );
}
