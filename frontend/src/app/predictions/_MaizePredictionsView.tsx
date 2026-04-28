"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  Line, LineChart,
  Scatter, ScatterChart, ZAxis,
  ReferenceLine,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  maizePredictionsClient,
  type MaizePredictionRow,
  type MaizePredictionsSummary,
} from "@/lib/api";
import { CHART_GRID_STROKE, semantic } from "@/lib/design-tokens";

const INITIAL_BATCH = 50;
const SCROLL_BATCH = 50;

function fmt(v: number | null | undefined, digits = 2): string {
  if (v == null) return "—";
  return v.toLocaleString(undefined, { maximumFractionDigits: digits });
}

interface Config {
  /** Page title shown in the H1, e.g. "Maize Yield (LightGBM)". */
  title: string;
  /** Short description for the header. */
  description: string;
  /** Sync button label, e.g. "Sync LightGBM predictions". */
  syncLabel: string;
  /** API base path mounted in the backend, e.g. "/api/v1/predictions-lightgbm". */
  apiPathBase: string;
}

export default function MaizePredictionsView({ config }: { config: Config }) {
  const client = useMemo(() => maizePredictionsClient(config.apiPathBase), [config.apiPathBase]);

  const [regions, setRegions] = useState<string[]>([]);
  // "All regions" sentinel = full unfiltered view; otherwise filter to one region.
  const [region, setRegion] = useState<string>("All regions");
  const [allRows, setAllRows] = useState<MaizePredictionRow[]>([]);
  const [summary, setSummary] = useState<MaizePredictionsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [visible, setVisible] = useState(INITIAL_BATCH);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  async function refresh() {
    setLoading(true);
    const [r, all, s] = await Promise.all([
      client.getRegions(),
      client.list({ limit: 5000 }),
      client.getSummary(),
    ]);
    setRegions(r);
    setAllRows(all.data);
    setSummary(s);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  // Hydrate region selection from ?region=. Effect (not state initializer)
  // keeps SSR + first client render aligned.
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("region");
    if (fromUrl) setRegion(fromUrl);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("region") === region) return;
    url.searchParams.set("region", region);
    window.history.replaceState(null, "", url.toString());
  }, [region]);

  async function handleSync() {
    setSyncing(true);
    setSyncMsg(null);
    const res = await client.sync((e) => {
      setSyncMsg(e.message ?? `${e.stage} ${e.pct}%`);
    });
    setSyncMsg(res.message);
    setSyncing(false);
    refresh();
  }

  const isAll = region === "All regions";

  // Line chart needs a single region (17 lines would be unreadable). When in
  // "All regions" mode, fall back to the alphabetically-first region.
  const lineRegion = isAll ? (regions[0] ?? "Ashanti") : region;
  const regionRows = useMemo(
    () =>
      [...allRows]
        .filter((r) => r.region === lineRegion)
        .sort((a, b) => a.year - b.year),
    [allRows, lineRegion],
  );

  // Continuous year range for the chart's x-axis. Backtest history ends a few
  // years before TabPFN's future rows start (e.g. backtest through 2023, future
  // rows for 2025+2026), so the gap year(s) — currently 2024 — would be
  // dropped from the data set entirely and the axis would skip the tick.
  // Fill the gap with null-valued rows so each year between min and max gets
  // its own x position; `connectNulls` on the Line series bridges the visual.
  const chartRows = useMemo(() => {
    if (regionRows.length === 0) return regionRows;
    const byYear = new Map(regionRows.map((r) => [r.year, r]));
    const minYear = regionRows[0].year;
    const maxYear = regionRows[regionRows.length - 1].year;
    const filled: typeof regionRows = [];
    for (let y = minYear; y <= maxYear; y++) {
      filled.push(byYear.get(y) ?? ({ year: y, region: lineRegion, source: "future" } as (typeof regionRows)[number]));
    }
    return filled;
  }, [regionRows, lineRegion]);

  const tableRows = useMemo(
    () =>
      isAll
        ? [...allRows].sort((a, b) =>
            a.year !== b.year ? a.year - b.year : a.region.localeCompare(b.region),
          )
        : regionRows,
    [allRows, regionRows, isAll],
  );

  const backtestScatter = useMemo(
    () =>
      allRows
        .filter((r) => r.source === "backtest" && r.actual_yield != null && r.pred_yield != null)
        .map((r) => ({ actual: r.actual_yield as number, pred: r.pred_yield as number, region: r.region, year: r.year })),
    [allRows],
  );

  const scatterMax = useMemo(() => {
    if (backtestScatter.length === 0) return 5;
    return Math.ceil(Math.max(...backtestScatter.flatMap((d) => [d.actual, d.pred]))) + 1;
  }, [backtestScatter]);

  useEffect(() => {
    setVisible(INITIAL_BATCH);
  }, [region]);

  const pageRows = tableRows.slice(0, visible);
  const hasMore = visible < tableRows.length;

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisible((v) => Math.min(tableRows.length, v + SCROLL_BATCH));
        }
      },
      { rootMargin: "200px" },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [hasMore, tableRows.length]);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-end justify-between gap-4 flex-wrap pb-4 border-b border-border">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            Predictions
          </div>
          <h1 className="text-2xl font-bold text-foreground leading-tight">{config.title}</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">{config.description}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <SearchableSelect
            options={[
              { value: "All regions", label: "All regions" },
              ...regions.map((r) => ({ value: r, label: r })),
            ]}
            value={region}
            onValueChange={setRegion}
            placeholder="Filter region"
            className="w-48"
          />
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-2 bg-foreground text-background px-4 py-2 rounded-full text-sm font-medium hover:bg-foreground/90 disabled:opacity-70 disabled:cursor-not-allowed transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing..." : config.syncLabel}
          </button>
        </div>
      </div>

      {syncMsg && <div className="text-xs text-muted-foreground">{syncMsg}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryTile
          label="Backtest rows"
          value={summary?.backtest_rows ?? 0}
          sub={
            summary?.backtest_year_min && summary?.backtest_year_max
              ? `${summary.backtest_year_min}–${summary.backtest_year_max}`
              : "—"
          }
        />
        <SummaryTile
          label="Future rows"
          value={summary?.future_rows ?? 0}
          sub={summary?.future_horizon_year ? `Through ${summary.future_horizon_year}` : "—"}
        />
        <SummaryTile
          label="Yield RMSE"
          value={summary?.yield_rmse_mt_ha != null ? summary.yield_rmse_mt_ha.toFixed(2) : "—"}
          sub="mt/ha · backtest"
        />
        <SummaryTile label="Regions" value={regions.length} sub="Reporting" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Actual vs Predicted Yield</CardTitle>
          <CardDescription>
            mt/ha · {lineRegion}
            {isAll && " (showing first region; pick one in the dropdown to switch)"}. Backtest portion overlaps with actuals; the future portion extends past the last actual year.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="h-64 animate-pulse bg-muted/40 rounded" />
          ) : regionRows.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">
              No prediction data for this region.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={chartRows} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                <XAxis dataKey="year" tick={{ fontSize: 10 }} tickMargin={2} />
                <YAxis tick={{ fontSize: 10 }} width={35} tickMargin={2} />
                <Tooltip
                  contentStyle={{ fontSize: 11 }}
                  formatter={(v: number, n: string) => [v != null ? `${v.toFixed(2)} mt/ha` : "—", n]}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line
                  type="monotone"
                  dataKey="actual_yield"
                  name="Actual"
                  stroke={semantic.production}
                  strokeWidth={2}
                  dot={{ r: 2 }}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="pred_yield"
                  name="Predicted"
                  stroke={semantic.imports}
                  strokeWidth={2}
                  strokeDasharray="4 2"
                  dot={{ r: 2 }}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Backtest Accuracy</CardTitle>
          <CardDescription>
            Actual vs predicted yield for all regions × backtest years. Points on the diagonal are perfect predictions; below = under-forecast, above = over-forecast.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="h-72 animate-pulse bg-muted/40 rounded" />
          ) : backtestScatter.length === 0 ? (
            <div className="h-72 flex items-center justify-center text-sm text-muted-foreground">
              No backtest rows available.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <ScatterChart margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                <XAxis
                  type="number"
                  dataKey="actual"
                  name="Actual"
                  unit=" mt/ha"
                  domain={[0, scatterMax]}
                  tick={{ fontSize: 10 }}
                  tickMargin={2}
                />
                <YAxis
                  type="number"
                  dataKey="pred"
                  name="Predicted"
                  unit=" mt/ha"
                  domain={[0, scatterMax]}
                  tick={{ fontSize: 10 }}
                  width={45}
                  tickMargin={2}
                />
                <ZAxis range={[40, 80]} />
                <Tooltip
                  cursor={{ strokeDasharray: "3 3" }}
                  contentStyle={{ fontSize: 11 }}
                  formatter={(v: number) => v.toFixed(2)}
                  labelFormatter={() => ""}
                />
                <ReferenceLine
                  segment={[
                    { x: 0, y: 0 },
                    { x: scatterMax, y: scatterMax },
                  ]}
                  stroke={semantic.neutral}
                  strokeDasharray="4 4"
                />
                <Scatter data={backtestScatter} fill={semantic.production} fillOpacity={0.6} />
              </ScatterChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card className="p-0 overflow-hidden">
        {tableRows.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No data. Click <span className="font-semibold">{config.syncLabel}</span> to compute predictions.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="text-left font-semibold tracking-wider px-3 py-2 whitespace-nowrap">Year</th>
                  {isAll && (
                    <th className="text-left font-semibold tracking-wider px-3 py-2 whitespace-nowrap">Region</th>
                  )}
                  <th className="text-left font-semibold tracking-wider px-3 py-2 whitespace-nowrap">Source</th>
                  <th className="text-right font-semibold tracking-wider px-3 py-2 whitespace-nowrap">Actual yield</th>
                  <th className="text-right font-semibold tracking-wider px-3 py-2 whitespace-nowrap">Pred yield</th>
                  <th className="text-right font-semibold tracking-wider px-3 py-2 whitespace-nowrap">Actual area</th>
                  <th className="text-right font-semibold tracking-wider px-3 py-2 whitespace-nowrap">Pred area</th>
                  <th className="text-right font-semibold tracking-wider px-3 py-2 whitespace-nowrap">Actual prod</th>
                  <th className="text-right font-semibold tracking-wider px-3 py-2 whitespace-nowrap">Pred prod</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr key={`${r.year}-${r.region}-${r.source}`} className="border-t border-border hover:bg-muted/30">
                    <td className="px-3 py-1.5 tabular-nums whitespace-nowrap">{r.year}</td>
                    {isAll && <td className="px-3 py-1.5 whitespace-nowrap">{r.region}</td>}
                    <td className="px-3 py-1.5 whitespace-nowrap">{r.source}</td>
                    <td className="px-3 py-1.5 tabular-nums text-right">{fmt(r.actual_yield)}</td>
                    <td className="px-3 py-1.5 tabular-nums text-right">{fmt(r.pred_yield)}</td>
                    <td className="px-3 py-1.5 tabular-nums text-right">{fmt(r.actual_area, 0)}</td>
                    <td className="px-3 py-1.5 tabular-nums text-right">{fmt(r.pred_area, 0)}</td>
                    <td className="px-3 py-1.5 tabular-nums text-right">{fmt(r.actual_production, 0)}</td>
                    <td className="px-3 py-1.5 tabular-nums text-right">{fmt(r.pred_production, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {hasMore && (
        <div ref={sentinelRef} className="flex items-center justify-center py-4 text-xs text-muted-foreground">
          Loading more…
        </div>
      )}
      {!hasMore && tableRows.length > INITIAL_BATCH && (
        <div className="text-center py-4 text-xs text-muted-foreground">
          End of {tableRows.length} rows.
        </div>
      )}
    </div>
  );
}

function SummaryTile({ label, value, sub }: { label: string; value: string | number; sub: string }) {
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
