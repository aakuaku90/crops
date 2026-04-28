"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  Area, ComposedChart,
  Bar, BarChart,
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
  forecast: number | null;
  ribbonLow: number | null;
  ribbonRange: number | null;
}

export default function MaizePricesForecastLanding() {
  const [markets, setMarkets] = useState<string[]>([]);
  const [market, setMarket] = useState<string>("");
  const [currency, setCurrency] = useState<Currency>("GHS");
  const [rows, setRows] = useState<MaizePriceForecastRow[]>([]);
  const [meta, setMeta] = useState<MaizePriceForecastMeta[]>([]);
  const [summary, setSummary] = useState<MaizePriceForecastSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  async function refresh(currentMarket?: string) {
    setLoading(true);
    const [m, s, mt] = await Promise.all([
      getMaizePriceForecastMarkets(),
      getMaizePriceForecastSummary(),
      getMaizePriceForecastMeta(),
    ]);
    setMarkets(m);
    setSummary(s);
    setMeta(mt);
    const target = currentMarket && m.includes(currentMarket) ? currentMarket : (m[0] ?? "");
    setMarket(target);
    if (target) {
      const r = await getMaizePriceForecast({ market: target, limit: 5000 });
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

  async function handleSync() {
    setSyncing(true);
    setSyncMsg("Sync started — Prophet fits ~3-5 min for all maize markets");
    const res = await syncMaizePriceForecast((e) => {
      setSyncMsg(e.message ?? `${e.stage} ${e.pct}%`);
    });
    setSyncMsg(res.message);
    setSyncing(false);
    refresh(market);
  }

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

  const pred = (r: MaizePriceForecastRow) =>
    currency === "GHS" ? r.pred_price_ghs : r.pred_price_usd;
  const actual = (r: MaizePriceForecastRow) =>
    currency === "GHS" ? r.actual_price_ghs : r.actual_price_usd;
  const lower = (r: MaizePriceForecastRow) =>
    currency === "GHS" ? r.pred_price_lower_ghs : r.pred_price_lower_usd;
  const upper = (r: MaizePriceForecastRow) =>
    currency === "GHS" ? r.pred_price_upper_ghs : r.pred_price_upper_usd;

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

  // Trajectory: actual (solid) and forecast (dashed) only — backtest preds
  // and in-sample fits are stripped for the consumer view.
  const chartData = useMemo<ChartPoint[]>(() => {
    return sortedRows.map((r) => {
      const a = actual(r);
      const lo = lower(r);
      const up = upper(r);
      const showRibbon = r.phase === "forecast" && lo != null && up != null;
      return {
        ds: r.month_date,
        actual: a,
        forecast: r.phase === "forecast" ? pred(r) : null,
        ribbonLow: showRibbon ? lo : null,
        ribbonRange: showRibbon ? (up as number) - (lo as number) : null,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedRows, currency]);

  // Bridge actual → forecast at the seam so the two lines visually connect.
  const bridged = useMemo<ChartPoint[]>(() => {
    if (!lastHistory) return chartData;
    const out = chartData.map((p) => ({ ...p }));
    const seamIdx = out.findIndex((p) => p.ds === lastHistory);
    if (seamIdx >= 0 && out[seamIdx].actual != null) {
      const firstFcIdx = out.findIndex(
        (p) => p.ds > lastHistory && p.forecast != null,
      );
      if (firstFcIdx >= 0 && out[firstFcIdx].actual == null) {
        out[firstFcIdx].actual = out[seamIdx].actual;
      }
      if (out[seamIdx].forecast == null) {
        out[seamIdx].forecast = out[seamIdx].actual;
      }
    }
    return out;
  }, [chartData, lastHistory]);

  const yMax = useMemo(() => {
    const vals = bridged.flatMap((p) =>
      [
        p.actual,
        p.forecast,
        p.ribbonLow != null && p.ribbonRange != null ? p.ribbonLow + p.ribbonRange : null,
      ].filter((v): v is number => v != null),
    );
    if (!vals.length) return 1;
    return Math.ceil(Math.max(...vals) * 1.1 * 10) / 10;
  }, [bridged]);

  const myMeta = useMemo(
    () => meta.find((m) => m.market === market) ?? null,
    [meta, market],
  );

  const symbol = currency === "GHS" ? "GH₵" : "$";
  const unit = myMeta?.unit ?? rows[0]?.unit ?? "100 KG";

  // Cross-market bar — projected price at horizon, sorted descending. Pulled
  // from a dedicated fetch since `rows` is filtered to the selected market.
  const [horizonByMarket, setHorizonByMarket] = useState<
    { market: string; horizon: number | null }[]
  >([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const all = await getMaizePriceForecast({ phase: "forecast", limit: 20000 });
      if (cancelled) return;
      // Pick each market's row at its own horizon date (max month_date per market).
      const byMarket = new Map<string, MaizePriceForecastRow>();
      for (const r of all.data) {
        const cur = byMarket.get(r.market);
        if (!cur || r.month_date > cur.month_date) byMarket.set(r.market, r);
      }
      const list = Array.from(byMarket.values())
        .map((r) => ({
          market: r.market,
          horizon:
            currency === "GHS" ? r.pred_price_ghs : r.pred_price_usd,
        }))
        .sort((a, b) => (b.horizon ?? 0) - (a.horizon ?? 0));
      setHorizonByMarket(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [currency]);

  const lastActualByMonth = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of sortedRows) {
      if (r.phase === "forecast") continue;
      const a = actual(r);
      if (a == null) continue;
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

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page header — title + sync action only. Filter controls live below. */}
      <div className="flex items-end justify-between gap-4 flex-wrap pb-4 border-b border-border">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            Forecast
          </div>
          <h1 className="text-2xl font-bold text-foreground leading-tight">
            Maize Price Forecast
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            12-month wholesale maize price projections by market, generated by Prophet.
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

      {/* KPI tiles — cross-market summary */}
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
          label="Avg projected price"
          value={
            summary?.avg_pred_horizon_ghs != null
              ? `${summary.avg_pred_horizon_ghs.toFixed(2)} GH₵`
              : "—"
          }
          sub={`Per ${unit} at horizon`}
        />
        <SummaryTile
          label="Avg backtest accuracy"
          value={
            summary?.avg_backtest_mape_pct != null
              ? `±${summary.avg_backtest_mape_pct.toFixed(1)}%`
              : "—"
          }
          sub="Mean abs % error, holdout"
        />
      </div>

      {/* Hero — selected-market trajectory */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Price Trajectory · {market || "—"}
          </CardTitle>
          <CardDescription>
            {symbol} per {unit}. Solid = actual (WFP); dashed = forecast; shaded band = 95% interval.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-72 w-full" />
          ) : bridged.length === 0 ? (
            <div className="h-72 flex items-center justify-center text-sm text-muted-foreground">
              No forecast available for this market.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={bridged} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
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
                  tickFormatter={(v: number) => v.toFixed(0)}
                />
                <Tooltip
                  contentStyle={{ fontSize: 11 }}
                  labelFormatter={(v: string) => v.slice(0, 7)}
                  formatter={(v: number, n: string) => {
                    if (n === "ribbonLow" || n === "ribbonRange") return [null, null] as never;
                    const label = n === "actual" ? "Actual" : "Forecast";
                    return [v != null ? `${symbol}${v.toFixed(2)}` : "—", label];
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 11 }}
                  formatter={(v: string) =>
                    v === "actual" ? "Actual" : v === "forecast" ? "Forecast" : "95% interval"
                  }
                  payload={[
                    { value: "actual", type: "line", color: semantic.production },
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

      {/* Cross-market bar — projected horizon price by market */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Projected Horizon Price by Market
          </CardTitle>
          <CardDescription>
            {symbol} per {unit} at {ymd(summary?.horizon_date)}, across all forecasted markets.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-64 w-full" />
          ) : horizonByMarket.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">
              No horizon data.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart
                data={horizonByMarket}
                margin={{ top: 4, right: 16, left: 0, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} vertical={false} />
                <XAxis
                  dataKey="market"
                  tick={{ fontSize: 10 }}
                  interval={0}
                  angle={-35}
                  textAnchor="end"
                  height={70}
                />
                <YAxis
                  tick={{ fontSize: 10 }}
                  width={55}
                  tickFormatter={(v: number) => v.toFixed(0)}
                />
                <Tooltip
                  contentStyle={{ fontSize: 11 }}
                  formatter={(v: number) => [`${symbol}${v.toFixed(2)}`, "Horizon price"]}
                />
                <Bar dataKey="horizon" fill={semantic.area} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Forecast detail table */}
      <Card className="p-0 overflow-hidden">
        {tableRows.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No forecast rows.
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
                {tableRows.map((r) => {
                  const p = pred(r);
                  const lo = lower(r);
                  const up = upper(r);
                  const mm = r.month_date.slice(5, 7);
                  const last = lastActualByMonth.get(mm);
                  const yoy =
                    p != null && last != null && last !== 0 ? (p - last) / last : null;
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
