"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  Area, ComposedChart,
  Line,
  ReferenceArea, ReferenceLine,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  getMaizePriceForecast,
  getMaizePriceForecastMarkets,
  getMaizePriceForecastMeta,
  getMaizePriceForecastSummary,
  syncMaizePriceForecast,
  type MaizePriceForecastRow,
  type MaizePriceForecastMeta,
  type MaizePriceForecastSummary,
} from "@/lib/api";
import { CHART_GRID_STROKE, semantic } from "@/lib/design-tokens";

type Currency = "GHS" | "USD";

const INITIAL_BATCH = 100;
const SCROLL_BATCH = 100;

function fmt(v: number | null | undefined, digits = 2): string {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function ymd(date: string | null | undefined): string {
  if (!date) return "—";
  return date.slice(0, 7); // YYYY-MM
}

interface ChartPoint {
  ds: string;
  actual: number | null;
  fit: number | null;       // in-sample (train phase)
  backtest: number | null;  // out-of-sample backtest pred
  forecast: number | null;  // future
  ribbonLow: number | null;
  ribbonRange: number | null; // upper - low, stacked above ribbonLow
}

export default function MaizePricesForecastPage() {
  const [markets, setMarkets] = useState<string[]>([]);
  const [market, setMarket] = useState<string>("");
  const [currency, setCurrency] = useState<Currency>("GHS");
  const [rows, setRows] = useState<MaizePriceForecastRow[]>([]);
  const [meta, setMeta] = useState<MaizePriceForecastMeta[]>([]);
  const [summary, setSummary] = useState<MaizePriceForecastSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [visible, setVisible] = useState(INITIAL_BATCH);

  async function refresh() {
    setLoading(true);
    const [m, s, mt] = await Promise.all([
      getMaizePriceForecastMarkets(),
      getMaizePriceForecastSummary(),
      getMaizePriceForecastMeta(),
    ]);
    setMarkets(m);
    setSummary(s);
    setMeta(mt);
    if (m.length && !market) setMarket(m[0]);
    // Pull rows for either the initial market or the current selection.
    const initialMarket = m.length && !market ? m[0] : market;
    if (initialMarket) {
      const r = await getMaizePriceForecast({ market: initialMarket, limit: 5000 });
      setRows(r.data);
    } else {
      setRows([]);
    }
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pull rows whenever the market changes (after the initial mount).
  useEffect(() => {
    if (!market) return;
    let cancelled = false;
    (async () => {
      const r = await getMaizePriceForecast({ market, limit: 5000 });
      if (!cancelled) setRows(r.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [market]);

  async function handleSync() {
    setSyncing(true);
    setSyncMsg("Sync started — Prophet fits ~3-5 min for all maize markets");
    const res = await syncMaizePriceForecast((e) => {
      setSyncMsg(e.message ?? `${e.stage} ${e.pct}%`);
    });
    setSyncMsg(res.message);
    setSyncing(false);
    refresh();
  }

  // Pick the right currency lens from a row.
  function pred(r: MaizePriceForecastRow): number | null {
    return currency === "GHS" ? r.pred_price_ghs : r.pred_price_usd;
  }
  function actual(r: MaizePriceForecastRow): number | null {
    return currency === "GHS" ? r.actual_price_ghs : r.actual_price_usd;
  }
  function lower(r: MaizePriceForecastRow): number | null {
    return currency === "GHS" ? r.pred_price_lower_ghs : r.pred_price_lower_usd;
  }
  function upper(r: MaizePriceForecastRow): number | null {
    return currency === "GHS" ? r.pred_price_upper_ghs : r.pred_price_upper_usd;
  }

  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => a.month_date.localeCompare(b.month_date)),
    [rows],
  );

  const lastHistory = useMemo(() => {
    const histRows = sortedRows.filter((r) => r.phase !== "forecast");
    return histRows.length ? histRows[histRows.length - 1].month_date : null;
  }, [sortedRows]);

  const horizonDate = useMemo(() => {
    const futRows = sortedRows.filter((r) => r.phase === "forecast");
    return futRows.length ? futRows[futRows.length - 1].month_date : null;
  }, [sortedRows]);

  // Build the chart series with phase-aware columns.
  const chartData = useMemo<ChartPoint[]>(() => {
    return sortedRows.map((r) => {
      const a = actual(r);
      const p = pred(r);
      const lo = lower(r);
      const up = upper(r);
      const showRibbon = r.phase === "forecast" && lo != null && up != null;
      return {
        ds: r.month_date,
        actual: a,
        fit: r.phase === "train" ? p : null,
        backtest: r.phase === "backtest" ? p : null,
        forecast: r.phase === "forecast" ? p : null,
        ribbonLow: showRibbon ? lo : null,
        ribbonRange: showRibbon ? (up as number) - (lo as number) : null,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedRows, currency]);

  const yMax = useMemo(() => {
    const vals = chartData.flatMap((p) =>
      [
        p.actual,
        p.fit,
        p.backtest,
        p.forecast,
        p.ribbonLow != null && p.ribbonRange != null ? p.ribbonLow + p.ribbonRange : null,
      ].filter((v): v is number => v != null),
    );
    if (!vals.length) return 1;
    return Math.ceil(Math.max(...vals) * 1.1 * 10) / 10;
  }, [chartData]);

  const myMeta = useMemo(
    () => meta.find((m) => m.market === market) ?? null,
    [meta, market],
  );

  const symbol = currency === "GHS" ? "GH₵" : "$";
  const unit = myMeta?.unit ?? rows[0]?.unit ?? "";

  // Per-market table — forecast rows, with YoY % vs same month last year actual.
  const lastActualByMonthName = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of sortedRows) {
      if (r.phase === "forecast") continue;
      const a = actual(r);
      if (a == null) continue;
      // key = MM (month-of-year) → last actual price for that month
      const mm = r.month_date.slice(5, 7);
      map.set(mm, a);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedRows, currency]);

  const tableRows = useMemo(
    () => sortedRows.filter((r) => r.phase === "forecast"),
    [sortedRows],
  );

  const pageRows = tableRows.slice(0, visible);
  const hasMore = visible < tableRows.length;

  useEffect(() => {
    setVisible(INITIAL_BATCH);
  }, [market, currency]);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page header — title + sync action only. Filter controls live below. */}
      <div className="flex items-end justify-between gap-4 flex-wrap pb-4 border-b border-border">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            Predictions
          </div>
          <h1 className="text-2xl font-bold text-foreground leading-tight">
            Maize Prices (Prophet)
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            Per-market 12-month maize price forecast (Prophet, CPI regressor) with backtest evaluation.
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
        <CurrencyToggle value={currency} onChange={setCurrency} />
        <SearchableSelect
          options={markets.map((m) => ({ value: m, label: m }))}
          value={market}
          onValueChange={setMarket}
          placeholder="Select market"
          className="w-56"
        />
      </div>

      {syncMsg && <div className="text-xs text-muted-foreground">{syncMsg}</div>}

      {/* KPI tiles (cross-market summary, not the selected market) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryTile
          label="Markets"
          value={summary?.n_markets ?? 0}
          sub="With ≥36 mo history"
        />
        <SummaryTile
          label="Forecast horizon"
          value={ymd(summary?.horizon_date)}
          sub={summary?.last_history_date ? `From ${ymd(summary.last_history_date)}` : "—"}
        />
        <SummaryTile
          label="Avg backtest RMSE"
          value={
            summary?.avg_backtest_rmse_ghs != null
              ? `${summary.avg_backtest_rmse_ghs.toFixed(2)} GH₵`
              : "—"
          }
          sub="Out-of-sample, 12-mo holdout"
        />
        <SummaryTile
          label="Avg projected price"
          value={
            summary?.avg_pred_horizon_ghs != null
              ? `${summary.avg_pred_horizon_ghs.toFixed(2)} GH₵`
              : "—"
          }
          sub="At horizon, across markets"
        />
      </div>

      {/* Per-market accuracy band */}
      {myMeta && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <SummaryTile
            label="Backtest RMSE"
            value={
              myMeta.backtest_rmse_ghs != null
                ? `${myMeta.backtest_rmse_ghs.toFixed(2)} GH₵`
                : "—"
            }
            sub={`${myMeta.n_backtest} held-out months`}
          />
          <SummaryTile
            label="Backtest MAPE"
            value={
              myMeta.backtest_mape_pct != null
                ? `${myMeta.backtest_mape_pct.toFixed(1)}%`
                : "—"
            }
            sub="Mean abs % error"
          />
          <SummaryTile
            label="CPI sensitivity (β)"
            value={myMeta.cpi_beta != null ? myMeta.cpi_beta.toFixed(3) : "—"}
            sub="Price units per 1pt CPI"
          />
          <SummaryTile
            label="Training months"
            value={myMeta.n_train}
            sub={myMeta.unit ?? "—"}
          />
        </div>
      )}

      {/* Hero — price trajectory */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Price Trajectory · {market || "—"}
          </CardTitle>
          <CardDescription>
            {symbol}
            {unit ? ` per ${unit}` : ""}. Solid = actual; thin = in-sample fit;
            dotted = held-out backtest pred; dashed = forecast w/ 95% interval ribbon.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-72 w-full" />
          ) : chartData.length === 0 ? (
            <div className="h-72 flex items-center justify-center text-sm text-muted-foreground">
              No forecast data. Click <span className="font-semibold mx-1">Sync forecast</span> to generate.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                <defs>
                  <linearGradient id="forecastBand" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={semantic.supply} stopOpacity={0.18} />
                    <stop offset="100%" stopColor={semantic.supply} stopOpacity={0.04} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                <XAxis
                  dataKey="ds"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v: string) => v.slice(0, 7)}
                  minTickGap={32}
                />
                <YAxis
                  tick={{ fontSize: 10 }}
                  width={50}
                  tickMargin={2}
                  domain={[0, yMax]}
                  tickFormatter={(v: number) => v.toFixed(2)}
                />
                <Tooltip
                  contentStyle={{ fontSize: 11 }}
                  labelFormatter={(v: string) => v.slice(0, 7)}
                  formatter={(v: number, n: string) => {
                    if (n === "ribbonLow" || n === "ribbonRange") return [null, null] as never;
                    const label = n === "actual" ? "Actual"
                      : n === "fit" ? "In-sample fit"
                      : n === "backtest" ? "Backtest pred"
                      : n === "forecast" ? "Forecast"
                      : n;
                    return [v != null ? `${symbol}${v.toFixed(2)}` : "—", label];
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 11 }}
                  formatter={(v: string) =>
                    v === "actual" ? "Actual"
                    : v === "fit" ? "In-sample fit"
                    : v === "backtest" ? "Backtest pred"
                    : v === "forecast" ? "Forecast"
                    : v === "ribbonRange" ? "95% interval"
                    : v
                  }
                  payload={[
                    { value: "actual", type: "line", color: semantic.production },
                    { value: "fit", type: "line", color: semantic.neutral },
                    { value: "backtest", type: "line", color: semantic.cpi },
                    { value: "forecast", type: "line", color: semantic.area },
                    { value: "ribbonRange", type: "rect", color: semantic.supply },
                  ]}
                />
                {lastHistory && horizonDate && (
                  <ReferenceArea
                    x1={lastHistory}
                    x2={horizonDate}
                    y1={0}
                    y2={yMax}
                    fill="url(#forecastBand)"
                    stroke="none"
                  />
                )}
                {lastHistory && (
                  <ReferenceLine
                    x={lastHistory}
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
                {/* Forecast CI ribbon — stacked Areas: invisible base + tinted range */}
                <Area
                  type="monotone"
                  dataKey="ribbonLow"
                  stackId="ribbon"
                  stroke="none"
                  fill="transparent"
                  isAnimationActive={false}
                  legendType="none"
                />
                <Area
                  type="monotone"
                  dataKey="ribbonRange"
                  stackId="ribbon"
                  stroke="none"
                  fill={semantic.supply}
                  fillOpacity={0.18}
                  isAnimationActive={false}
                  legendType="none"
                />
                <Line
                  type="monotone"
                  dataKey="fit"
                  stroke={semantic.neutral}
                  strokeWidth={1}
                  dot={false}
                  connectNulls={false}
                />
                <Line
                  type="monotone"
                  dataKey="backtest"
                  stroke={semantic.cpi}
                  strokeWidth={2}
                  strokeDasharray="2 3"
                  dot={{ r: 2 }}
                  connectNulls={false}
                />
                <Line
                  type="monotone"
                  dataKey="actual"
                  stroke={semantic.production}
                  strokeWidth={2}
                  dot={{ r: 2 }}
                  connectNulls={false}
                />
                <Line
                  type="monotone"
                  dataKey="forecast"
                  stroke={semantic.area}
                  strokeWidth={2}
                  strokeDasharray="5 3"
                  dot={{ r: 2 }}
                  connectNulls={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Forecast detail table */}
      <Card className="p-0 overflow-hidden">
        {tableRows.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No forecast rows for this market.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="text-left font-semibold uppercase tracking-wider px-3 py-2 whitespace-nowrap">Month</th>
                  <th className="text-right font-semibold uppercase tracking-wider px-3 py-2 whitespace-nowrap">Forecast ({currency})</th>
                  <th className="text-right font-semibold uppercase tracking-wider px-3 py-2 whitespace-nowrap">95% lower</th>
                  <th className="text-right font-semibold uppercase tracking-wider px-3 py-2 whitespace-nowrap">95% upper</th>
                  <th className="text-right font-semibold uppercase tracking-wider px-3 py-2 whitespace-nowrap">YoY vs actual</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => {
                  const p = pred(r);
                  const lo = lower(r);
                  const up = upper(r);
                  const mm = r.month_date.slice(5, 7);
                  const lastSameMonth = lastActualByMonthName.get(mm);
                  const yoy =
                    p != null && lastSameMonth != null && lastSameMonth !== 0
                      ? (p - lastSameMonth) / lastSameMonth
                      : null;
                  return (
                    <tr
                      key={r.month_date}
                      className="border-t border-border hover:bg-muted/30"
                    >
                      <td className="px-3 py-1.5 tabular-nums">{r.month_date.slice(0, 7)}</td>
                      <td className="px-3 py-1.5 tabular-nums text-right">{p != null ? `${symbol}${fmt(p)}` : "—"}</td>
                      <td className="px-3 py-1.5 tabular-nums text-right">{lo != null ? `${symbol}${fmt(lo)}` : "—"}</td>
                      <td className="px-3 py-1.5 tabular-nums text-right">{up != null ? `${symbol}${fmt(up)}` : "—"}</td>
                      <td
                        className={`px-3 py-1.5 tabular-nums text-right ${
                          yoy == null
                            ? "text-muted-foreground"
                            : yoy >= 0
                            ? "text-destructive"
                            : "text-success"
                        }`}
                      >
                        {yoy == null
                          ? "—"
                          : `${yoy >= 0 ? "+" : ""}${(yoy * 100).toFixed(1)}%`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {hasMore && (
        <div className="text-center">
          <button
            onClick={() => setVisible((v) => v + SCROLL_BATCH)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Show more rows
          </button>
        </div>
      )}
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

function CurrencyToggle({
  value,
  onChange,
}: {
  value: Currency;
  onChange: (v: Currency) => void;
}) {
  return (
    <div className="inline-flex h-10 items-center rounded-full border border-input bg-background p-1 text-sm font-medium">
      {(["GHS", "USD"] as const).map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          className={`h-full px-4 rounded-full transition-colors ${
            value === c
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {c}
        </button>
      ))}
    </div>
  );
}
