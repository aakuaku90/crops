"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  Area,
  ComposedChart,
  Line,
  LineChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import { Card } from "@/components/ui/card";
import { ChatPanel } from "@/components/dashboard/ChatPanel";
import { PageSkeleton } from "@/components/dashboard/PageSkeleton";
import { RegionalMap } from "@/components/dashboard/RegionalMap";
import { CHART_GRID_STROKE, palette, semantic } from "@/lib/design-tokens";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  getFaoFoodBalances,
  getFaoPopulation,
  getFaoProducerPrices,
  getMaizePredictions,
  getMaizePriceForecastSummary,
  getTrackerCrops,
  syncMaizePredictions,
  syncMaizePriceForecast,
  type MaizePredictionRow,
  type MaizePriceForecastSummary,
} from "@/lib/api";

type Layer = "production" | "yield";
type Phase = "actual" | "forecast";

const CROP = "Maize";
const FORECAST_LOOKBACK_YEARS = 8; // history shown in supply/demand chart

const LAYER_OPTIONS = [
  { value: "production", label: "Production" },
  { value: "yield", label: "Yield" },
] as const;

const PHASE_OPTIONS = [
  { value: "actual", label: "Actual" },
  { value: "forecast", label: "Forecast" },
] as const;

function formatTonnes(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toFixed(0);
}

function pct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

/** Simple-linear OLS fit. Returns null if there's too little data or zero
 *  variance in x (degenerate case). Lifted from CropBalanceChart so the
 *  /forecast demand math matches what Historical Trends uses. */
function olsSimpleLinear(
  xs: number[],
  ys: number[],
): { intercept: number; slope: number } | null {
  if (xs.length < 3 || xs.length !== ys.length) return null;
  const n = xs.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  if (den === 0) return null;
  const slope = num / den;
  const intercept = my - slope * mx;
  return { intercept, slope };
}

/** Look up the producer price for a given year, falling back to the most
 *  recent prior year with a known price. Bridges gaps in the FAO series and
 *  carries the last known price forward into the forecast horizon. */
function priceForYear(prices: Record<number, number>, year: number): number | null {
  if (prices[year] != null) return prices[year];
  const knownYears = Object.keys(prices).map(Number).filter((y) => y <= year);
  if (knownYears.length === 0) return null;
  return prices[Math.max(...knownYears)] ?? null;
}

export default function ForecastOutlookPage() {
  const [layer, setLayer] = useState<Layer>("production");
  const [phase, setPhase] = useState<Phase>("forecast");
  const [predRows, setPredRows] = useState<MaizePredictionRow[]>([]);
  // FAO Food Balance, normalized to tonnes. We carry `food` separately because
  // the normative + econometric demand models need food consumption per capita
  // (not the broader Food + Feed + Losses aggregate).
  const [foodBalanceRaw, setFoodBalanceRaw] = useState<
    { year: number; production: number; demand: number; food: number }[]
  >([]);
  // Population in absolute people, keyed by year. Spans 1950 → 2100 since the
  // FAO/UN dataset includes official projections — no extrapolation needed.
  const [population, setPopulation] = useState<Record<number, number>>({});
  // Maize producer prices in LCU/tonne, keyed by year, forward-filled across
  // FAO reporting gaps so the econometric fit has continuous coverage.
  const [producerPrices, setProducerPrices] = useState<Record<number, number>>({});
  const [priceSummary, setPriceSummary] = useState<MaizePriceForecastSummary | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [crops, setCrops] = useState<string[]>([]);
  // Region selected on the map. When non-null, the ChatPanel scopes its
  // conversation to {crop, region} so the user can drill into local context.
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  // Drives the initial-load skeleton. Flips to true once `refreshAll()`
  // resolves the first time. Sync-button refreshes don't reset it — we
  // don't want the skeleton flashing every time the user re-syncs.
  const [loaded, setLoaded] = useState(false);
  // One-shot prompt to auto-send when the panel opens — set by buttons that
  // launch a specific question (e.g. "fetch current prices via web search").
  // ChatPanel dedupes by string, so we don't have to clear this back to null.
  const [chatPrompt, setChatPrompt] = useState<string | null>(null);

  // Fetch the tracker crop list once. The dropdown shows every crop, but only
  // "Maize" is currently selectable — others are flagged as "Soon" and
  // disabled. The selected value is locked to "Maize" in handleCropChange.
  useEffect(() => {
    getTrackerCrops().then(setCrops);
  }, []);

  const cropOptions = useMemo(() => {
    const list = crops.length ? crops : [CROP];
    // Ensure Maize is in the list and on top.
    const seen = new Set(list);
    if (!seen.has(CROP)) list.unshift(CROP);
    const sorted = [CROP, ...list.filter((c) => c !== CROP).sort()];
    return sorted.map((c) => ({
      value: c,
      label: c,
      disabled: c !== CROP,
    }));
  }, [crops]);

  // Ghana agricultural calendar — current season hint based on month.
  const [seasonNote, setSeasonNote] = useState<string>("In season");
  useEffect(() => {
    const m = new Date().getMonth();
    setSeasonNote(
      m >= 2 && m <= 4 ? "Planting (Mar–May)"
      : m >= 5 && m <= 7 ? "Lean season"
      : m >= 8 && m <= 10 ? "Main harvest"
      : "Off-season",
    );
  }, []);

  // ── Data fetches ────────────────────────────────────────────────────────────
  // Pulled into a single function so the Sync button can re-run them all
  // after a fresh forecast has been computed.
  async function refreshAll() {
    const [{ data: predData }, { data: fbData }, ps, popRows, ppRows] =
      await Promise.all([
        getMaizePredictions({ limit: 5000 }),
        getFaoFoodBalances(CROP, undefined, 500, 0),
        getMaizePriceForecastSummary(),
        getFaoPopulation("Total Population - Both sexes"),
        getFaoProducerPrices(CROP),
      ]);
    setPredRows(predData);
    setPriceSummary(ps);

    // Population: stored in `1000 No`; multiply to absolute people. Includes
    // FAO/UN projections through 2100 so we can look up demand-horizon years
    // (2025, 2026) directly without extrapolation.
    const popMap: Record<number, number> = {};
    for (const r of popRows) {
      if (r.year != null && r.value != null) popMap[r.year] = r.value * 1000;
    }
    setPopulation(popMap);

    // Producer prices (LCU/tonne) — forward-fill across reporting gaps so the
    // econometric fit has continuous coverage from first-known to last-known
    // year, and so we can carry the most recent price into the horizon.
    const priceMap: Record<number, number> = {};
    for (const r of ppRows) {
      if (!/lcu\/tonne/i.test(r.element ?? "")) continue;
      const year = new Date(r.start_date).getFullYear();
      if (r.value > 0) priceMap[year] = r.value;
    }
    const knownYears = Object.keys(priceMap).map(Number).sort((a, b) => a - b);
    if (knownYears.length >= 2) {
      let last = priceMap[knownYears[0]];
      for (let y = knownYears[0]; y <= knownYears[knownYears.length - 1]; y++) {
        if (priceMap[y] != null) last = priceMap[y];
        else priceMap[y] = last;
      }
    }
    setProducerPrices(priceMap);

    // FAO Food Balance values are stored in 1000 t (kilotonnes), while TabPFN
    // forecasts are in plain tonnes. Convert FAO to tonnes at load time so the
    // two series share a y-axis on the supply/demand chart and the surplus
    // ratio in Tile 2 isn't off by 1000×.
    const KT_TO_T = 1000;
    // The food-balances API returns every item matching ILIKE "Maize" — that
    // includes "Maize and products" (the primary balance) AND derivatives
    // like "Maize Germ Oil". Without filtering, the byYear map overwrites the
    // primary item's Food (e.g. 961 kt) with the derivative's Food (often 0)
    // because of last-write-wins. Restrict to the "<crop> and products" item
    // — same approach used by CropBalanceChart on the home page.
    const cropLc = CROP.toLowerCase();
    const primary = fbData.filter(
      (r) => (r.item ?? "").toLowerCase() === `${cropLc} and products`,
    );
    const fbRows = primary.length > 0 ? primary : fbData;
    const byYear: Record<number, { production: number; demand: number; food: number }> = {};
    for (const r of fbRows) {
      const el = (r.element ?? "").toLowerCase();
      if (!byYear[r.year]) byYear[r.year] = { production: 0, demand: 0, food: 0 };
      if (el === "production") byYear[r.year].production = r.value * KT_TO_T;
      if (el === "food") byYear[r.year].food = r.value * KT_TO_T;
      // Apparent-consumption proxy used elsewhere — Food + Losses + Feed.
      if (el === "food" || el === "losses" || el === "feed") {
        byYear[r.year].demand = (byYear[r.year].demand ?? 0) + r.value * KT_TO_T;
      }
    }
    setFoodBalanceRaw(
      Object.entries(byYear)
        .map(([y, v]) => ({ year: Number(y), ...v }))
        .filter((r) => r.production > 0 || r.demand > 0)
        .sort((a, b) => a.year - b.year),
    );
  }

  useEffect(() => {
    refreshAll().finally(() => setLoaded(true));
  }, []);

  async function handleSync() {
    setSyncing(true);
    // Yield ingestion is a CSV reload (~1s); price forecast is Prophet across
    // all maize markets (~3 min). Run sequentially so the user sees clean
    // stage messages instead of two streams interleaving.
    setSyncMsg("Syncing yield forecast (TabPFN)…");
    await syncMaizePredictions((e) => {
      setSyncMsg(`Yield: ${e.message ?? `${e.stage} ${e.pct}%`}`);
    });
    setSyncMsg("Syncing price forecast (Prophet, ~3 min)…");
    const finalRes = await syncMaizePriceForecast((e) => {
      setSyncMsg(`Price: ${e.message ?? `${e.stage} ${e.pct}%`}`);
    });
    setSyncMsg(finalRes.message ?? "Forecast sync complete");
    setSyncing(false);
    await refreshAll();
  }

  // ── Derived: forecast horizon, latest actual, regional map values ──────────
  const horizonYear = useMemo(() => {
    const future = predRows.filter((r) => r.source !== "backtest");
    if (!future.length) return null;
    return Math.max(...future.map((r) => r.year));
  }, [predRows]);

  const latestActualYear = useMemo(() => {
    const actual = predRows.filter((r) => r.actual_yield != null || r.actual_production != null);
    if (!actual.length) return null;
    return Math.max(...actual.map((r) => r.year));
  }, [predRows]);

  // Build region → value for the map shading. Switches between TabPFN
  // actuals at `latestActualYear` (phase=actual) and TabPFN predictions at
  // `horizonYear` (phase=forecast). The metric (yield vs production) is
  // orthogonal — works for either phase.
  const mapByRegion = useMemo(() => {
    const targetYear = phase === "actual" ? latestActualYear : horizonYear;
    if (!targetYear) return {};
    const out: Record<string, number> = {};
    for (const r of predRows) {
      if (r.year !== targetYear) continue;
      if (phase === "actual") {
        if (r.source !== "backtest") continue;
        const v = layer === "yield" ? r.actual_yield : r.actual_production;
        if (v != null) out[r.region] = v;
      } else {
        if (r.source === "backtest") continue;
        const v = layer === "yield" ? r.pred_yield : r.pred_production;
        if (v != null) out[r.region] = v;
      }
    }
    return out;
  }, [predRows, latestActualYear, horizonYear, layer, phase]);

  // National projected production at horizon (sum of TabPFN regional preds).
  const nationalProjected = useMemo(() => {
    if (!horizonYear) return 0;
    return predRows
      .filter((r) => r.year === horizonYear && r.source !== "backtest")
      .reduce((s, r) => s + (r.pred_production ?? 0), 0);
  }, [predRows, horizonYear]);

  // National actual production at the latest actual year.
  const nationalLatestActual = useMemo(() => {
    if (!latestActualYear) return null;
    const sum = predRows
      .filter((r) => r.year === latestActualYear)
      .reduce((s, r) => s + (r.actual_production ?? 0), 0);
    return sum > 0 ? sum : null;
  }, [predRows, latestActualYear]);

  const supplyGrowthPct = useMemo(() => {
    if (!nationalLatestActual || !nationalProjected) return null;
    return ((nationalProjected - nationalLatestActual) / nationalLatestActual) * 100;
  }, [nationalLatestActual, nationalProjected]);

  // ── Demand model fits — normative + econometric ────────────────────────────
  // Both models follow the same approach Historical Trends uses (see
  // CropBalanceChart). Normative: per-capita food consumption × population.
  // Econometric: log-linear OLS of per-capita demand on producer price, then
  // pop × predicted per-capita.
  const demandFits = useMemo(() => {
    // Per-capita norm — average kg/person across the most-recent 5 years
    // where both food and population are reported.
    const recent = foodBalanceRaw
      .filter((r) => population[r.year] && r.food > 0)
      .sort((a, b) => b.year - a.year)
      .slice(0, 5);
    const perCapitaNorm = recent.length
      ? recent.reduce((s, r) => s + r.food / population[r.year], 0) / recent.length
      : null;

    // Econometric fit — ln(food_per_capita) = α + β · ln(producer_price).
    const xs: number[] = [];
    const ys: number[] = [];
    for (const r of foodBalanceRaw) {
      const pop = population[r.year];
      const price = priceForYear(producerPrices, r.year);
      if (!pop || !price || r.food <= 0) continue;
      xs.push(Math.log(price));
      ys.push(Math.log(r.food / pop));
    }
    const econ = xs.length >= 5 ? olsSimpleLinear(xs, ys) : null;

    return { perCapitaNorm, econ };
  }, [foodBalanceRaw, population, producerPrices]);

  // ── Supply vs Demand series: history + projection ──────────────────────────
  // Supply uses FAO Production for history and TabPFN regional sums for the
  // forecast horizon. Demand uses TWO model lines that span every year so the
  // visual continuity tells users "same logic before and after the seam":
  //   demandNorm = pop × per-capita norm
  //   demandEcon = pop × exp(α + β · ln(price))
  const supplyDemandSeries = useMemo(() => {
    if (foodBalanceRaw.length === 0) return [];

    const minYear = foodBalanceRaw[0].year;
    const lastFaoYear = foodBalanceRaw.at(-1)!.year;
    const targetYear = Math.max(horizonYear ?? lastFaoYear, lastFaoYear);
    const historyStart = Math.max(minYear, lastFaoYear - FORECAST_LOOKBACK_YEARS + 1);

    // TabPFN national supply per future year.
    const tabpfnSupply = new Map<number, number>();
    for (const r of predRows) {
      if (r.source === "backtest" || r.year <= lastFaoYear) continue;
      tabpfnSupply.set(
        r.year,
        (tabpfnSupply.get(r.year) ?? 0) + (r.pred_production ?? 0),
      );
    }

    const faoByYear = new Map(foodBalanceRaw.map((r) => [r.year, r]));

    function demandNormFor(y: number): number | null {
      const pop = population[y];
      if (!pop || demandFits.perCapitaNorm == null) return null;
      return pop * demandFits.perCapitaNorm;
    }
    function demandEconFor(y: number): number | null {
      const pop = population[y];
      const price = priceForYear(producerPrices, y);
      if (!pop || !price || !demandFits.econ) return null;
      const kgPerPerson = Math.exp(
        demandFits.econ.intercept + demandFits.econ.slope * Math.log(price),
      );
      return kgPerPerson * pop;
    }

    const rows: {
      year: number;
      supply: number | null;
      forecastSupply: number | null;
      demandNorm: number | null;
      demandEcon: number | null;
    }[] = [];

    for (let y = historyStart; y <= targetYear; y++) {
      const fao = faoByYear.get(y);
      const isHistory = y <= lastFaoYear;
      const supply = isHistory ? fao?.production || null : null;
      // Forecast supply is null in history except at the seam (lastFaoYear),
      // where we mirror the FAO actual so the dashed line connects to the
      // solid line visually.
      let forecastSupply: number | null = null;
      if (y === lastFaoYear && tabpfnSupply.size > 0) {
        forecastSupply = supply;
      } else if (y > lastFaoYear) {
        forecastSupply = tabpfnSupply.get(y) ?? null;
      }
      rows.push({
        year: y,
        supply,
        forecastSupply,
        demandNorm: demandNormFor(y),
        demandEcon: demandEconFor(y),
      });
    }
    return rows;
  }, [foodBalanceRaw, predRows, horizonYear, population, producerPrices, demandFits]);

  // Headline numbers off the demand-model series at horizon.
  const horizonRow = supplyDemandSeries.at(-1) ?? null;
  const projectedSupply = horizonRow?.forecastSupply ?? null;
  const projectedDemandNorm = horizonRow?.demandNorm ?? null;
  const projectedDemandEcon = horizonRow?.demandEcon ?? null;

  // Average the two demand models for a single headline number; report the
  // corridor (min/max) so users see the uncertainty.
  const projectedDemandAvg = useMemo(() => {
    const vs = [projectedDemandNorm, projectedDemandEcon].filter(
      (v): v is number => v != null,
    );
    if (!vs.length) return null;
    return vs.reduce((s, v) => s + v, 0) / vs.length;
  }, [projectedDemandNorm, projectedDemandEcon]);

  function surplusPct(supply: number | null, demand: number | null): number | null {
    if (!supply || !demand) return null;
    return ((supply - demand) / demand) * 100;
  }
  const surplusNorm = surplusPct(projectedSupply, projectedDemandNorm);
  const surplusEcon = surplusPct(projectedSupply, projectedDemandEcon);
  const surplusAvg = surplusPct(projectedSupply, projectedDemandAvg);

  // Latest historical apparent consumption (Food + Feed + Losses) — used for
  // YoY framing in the timeline. Independent of the model lines.
  const latestHistDemand = useMemo(() => {
    const lastHist = [...foodBalanceRaw].reverse().find((r) => r.demand > 0);
    return lastHist?.demand ?? null;
  }, [foodBalanceRaw]);

  const demandGrowthPct = useMemo(() => {
    if (!latestHistDemand || !projectedDemandAvg) return null;
    return ((projectedDemandAvg - latestHistDemand) / latestHistDemand) * 100;
  }, [latestHistDemand, projectedDemandAvg]);

  // Projected price change at horizon (cross-market avg). Use last historical
  // month per market as the anchor — but `priceSummary.last_history_date` and
  // `avg_pred_horizon_ghs` are already the cross-market summary numbers.
  // To estimate % drift we need the historical anchor — fall back to a
  // simple "horizon vs current avg" heuristic via meta in a future iteration.
  // For now show the projected horizon price as the headline.
  const projPriceMessage = priceSummary?.avg_pred_horizon_ghs != null
    ? `${formatTonnes(priceSummary.avg_pred_horizon_ghs)} GH₵ / 100KG`
    : "—";

  if (!loaded) {
    return <PageSkeleton />;
  }

  return (
    <>
    <div className="space-y-5 animate-fade-in">
      {/* Page header */}
      <div className="flex items-end justify-between gap-4 flex-wrap pb-4 border-b border-border">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            Forecast
          </div>
          <h1 className="text-2xl font-bold text-foreground leading-tight">
            Demand &amp; Supply Forecast
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            National outlook on Ghana&apos;s crop supply and demand by region.
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

      {syncMsg && <div className="text-xs text-muted-foreground">{syncMsg}</div>}

      {/* Two-column shell. The right grid cell stretches to match the left
          column so the sticky wrapper inside has scroll travel room — without
          that, sticky has nothing to track against and the rail overflows. */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-5">
        {/* Left column */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2 flex-wrap">
            <SearchableSelect
              options={cropOptions}
              value={CROP}
              onValueChange={() => {
                /* Only Maize is currently selectable. The dropdown is mostly
                   informational — disabled options surface the rest of the
                   tracker's crop set so users see what's coming. */
              }}
              placeholder="Select crop"
              className="w-44"
              triggerClassName="rounded-full h-8 px-3 py-1 text-xs font-medium"
            />
            <div className="flex items-center rounded-full border border-border p-1 text-xs font-medium">
              {LAYER_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setLayer(opt.value)}
                  className={`rounded-full px-3 py-1 transition-colors ${
                    layer === opt.value
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
              <span className="w-px h-4 bg-border mx-1" aria-hidden />
              {PHASE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setPhase(opt.value)}
                  className={`rounded-full px-3 py-1 transition-colors ${
                    phase === opt.value
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <Card className="overflow-hidden p-0 flex-1 min-h-[600px]">
            <div className="h-full bg-muted/30">
              <RegionalMap
                crop={CROP}
                metric={layer}
                dataOverride={mapByRegion}
                ramp={phase === "forecast" ? "forecast" : "harvest"}
                onRegionSelect={(region) => {
                  setSelectedRegion(region);
                  // Auto-open the chat when a region is picked; user can close
                  // it without losing the selection (the back-button on the
                  // map clears both).
                  if (region) setChatOpen(true);
                }}
              />
            </div>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Card className="p-5">
              <div className="flex items-baseline justify-between mb-1">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    National Supply Outlook
                  </h3>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    FAO historical · TabPFN forecast through {horizonYear ?? "—"}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold tabular-nums text-foreground leading-none">
                    {projectedSupply ? `${formatTonnes(projectedSupply)} t` : "—"}
                  </div>
                  <div
                    className="text-[10px] font-medium tabular-nums mt-0.5"
                    style={{
                      color:
                        supplyGrowthPct == null
                          ? undefined
                          : supplyGrowthPct >= 0
                          ? semantic.down
                          : semantic.up,
                    }}
                  >
                    {supplyGrowthPct == null
                      ? `Projected ${horizonYear ?? "—"}`
                      : `${pct(supplyGrowthPct)} vs ${latestActualYear} actual`}
                  </div>
                </div>
              </div>
              <div className="h-56 mt-3">
                {supplyDemandSeries.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-[11px] text-muted-foreground">
                    Sync FAO Food Balances
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      data={supplyDemandSeries}
                      margin={{ top: 4, right: 8, left: -16, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="supplyAreaFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={semantic.exports} stopOpacity={0.25} />
                          <stop offset="100%" stopColor={semantic.exports} stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="supplyForecastFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={palette.grain[400]} stopOpacity={0.30} />
                          <stop offset="100%" stopColor={palette.grain[400]} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} vertical={false} />
                      <XAxis dataKey="year" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 10 }} tickFormatter={formatTonnes} width={48} />
                      <Tooltip
                        contentStyle={{ fontSize: 11 }}
                        formatter={(v: number, n: string) => {
                          const label = n === "supply" ? "Supply" : n === "forecastSupply" ? "Proj. supply" : n;
                          return [`${formatTonnes(v)} t`, label];
                        }}
                      />
                      {foodBalanceRaw.length > 0 && (
                        <ReferenceLine
                          x={foodBalanceRaw.at(-1)!.year}
                          stroke={semantic.neutral}
                          strokeDasharray="2 2"
                          label={{
                            value: "Forecast →",
                            position: "insideTopRight",
                            fill: semantic.neutral,
                            fontSize: 9,
                          }}
                        />
                      )}
                      <Area
                        type="monotone"
                        dataKey="supply"
                        name="Supply"
                        stroke={semantic.exports}
                        strokeWidth={2}
                        fill="url(#supplyAreaFill)"
                        connectNulls={false}
                      />
                      <Area
                        type="monotone"
                        dataKey="forecastSupply"
                        name="Proj. supply"
                        stroke={palette.grain[500]}
                        strokeWidth={2}
                        strokeDasharray="4 3"
                        fill="url(#supplyForecastFill)"
                        dot={{ r: 2, fill: palette.grain[500] }}
                        connectNulls
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </div>
            </Card>

            <Card className="p-5">
              <div className="flex items-baseline justify-between mb-1">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    National Demand Outlook
                  </h3>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Population × per-capita norm · OLS price-elastic model
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold tabular-nums text-foreground leading-none">
                    {projectedDemandAvg ? `${formatTonnes(projectedDemandAvg)} t` : "—"}
                  </div>
                  <div
                    className="text-[10px] font-medium tabular-nums mt-0.5"
                    style={{
                      color:
                        demandGrowthPct == null
                          ? undefined
                          : demandGrowthPct >= 0
                          ? semantic.up
                          : semantic.down,
                    }}
                  >
                    {demandGrowthPct == null
                      ? `Projected ${horizonYear ?? "—"}`
                      : `${pct(demandGrowthPct)} vs latest hist.`}
                  </div>
                </div>
              </div>
              <div className="h-56 mt-3">
                {supplyDemandSeries.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-[11px] text-muted-foreground">
                    Need FAO Food Balances + Population
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      data={supplyDemandSeries}
                      margin={{ top: 4, right: 8, left: -16, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="demandNormFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={semantic.up} stopOpacity={0.18} />
                          <stop offset="100%" stopColor={semantic.up} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} vertical={false} />
                      <XAxis dataKey="year" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 10 }} tickFormatter={formatTonnes} width={48} />
                      <Tooltip
                        contentStyle={{ fontSize: 11 }}
                        formatter={(v: number, n: string) => {
                          const label =
                            n === "demandNorm"
                              ? "Demand (normative)"
                              : n === "demandEcon"
                              ? "Demand (econometric)"
                              : n;
                          return [`${formatTonnes(v)} t`, label];
                        }}
                      />
                      {foodBalanceRaw.length > 0 && (
                        <ReferenceLine
                          x={foodBalanceRaw.at(-1)!.year}
                          stroke={semantic.neutral}
                          strokeDasharray="2 2"
                          label={{
                            value: "Forecast →",
                            position: "insideTopRight",
                            fill: semantic.neutral,
                            fontSize: 9,
                          }}
                        />
                      )}
                      <Area
                        type="monotone"
                        dataKey="demandNorm"
                        name="Demand (normative)"
                        stroke={semantic.up}
                        strokeWidth={2}
                        fill="url(#demandNormFill)"
                        connectNulls
                      />
                      <Line
                        type="monotone"
                        dataKey="demandEcon"
                        name="Demand (econometric)"
                        stroke={palette.terracotta[600]}
                        strokeWidth={1.75}
                        strokeDasharray="4 3"
                        dot={false}
                        connectNulls
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </div>
              <div className="grid grid-cols-2 gap-x-3 text-[10px] text-muted-foreground mt-3">
                <LegendDot color={semantic.up} label="Normative (pop × norm)" />
                <LegendDot color={palette.terracotta[600]} label="Econometric (price-elastic)" dashed />
              </div>
            </Card>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Tile
              eyebrow={`Projected production (${horizonYear ?? "—"})`}
              value={formatTonnes(nationalProjected)}
              unit="t"
              sub={
                supplyGrowthPct == null
                  ? "Sum of regional TabPFN forecasts"
                  : `${pct(supplyGrowthPct)} vs ${latestActualYear} actual`
              }
              accent
            />
            <Tile
              eyebrow="Supply / Demand"
              value={surplusAvg == null ? "—" : pct(surplusAvg)}
              unit={surplusAvg != null && surplusAvg >= 0 ? "surplus" : "gap"}
              sub={
                surplusNorm != null && surplusEcon != null
                  ? `Norm ${pct(surplusNorm, 0)} · Econ ${pct(surplusEcon, 0)} (${horizonYear ?? "—"})`
                  : `Projected ${horizonYear ?? "—"}`
              }
            />
            <Tile
              eyebrow="Projected price (12-mo)"
              value={projPriceMessage}
              unit="avg"
              sub={
                priceSummary?.horizon_date
                  ? `Across ${priceSummary.n_markets} markets · ${priceSummary.horizon_date.slice(0, 7)}`
                  : "No price forecast yet"
              }
            />
          </div>
        </div>

        {/* Right rail — sticky inside a column that stretches to the left's
            height. The outer div is the grid cell (full row height); the inner
            div is the actual rail content, pinned with sticky as the user
            scrolls. No internal scrollbar — content just stays at top-4. */}
        <div>
          <div className="flex flex-col gap-4 xl:sticky xl:top-4">
          <Card className="p-5 flex flex-col">
            <h3 className="text-sm font-semibold text-foreground mb-4">Forecast Timeline</h3>

            <TimelineItem
              label="This month"
              status={seasonNote}
              title="Current Season"
              detail={
                latestActualYear != null
                  ? `Latest reported year: ${latestActualYear}` + (
                      nationalLatestActual ? ` (${formatTonnes(nationalLatestActual)} t)` : ""
                    )
                  : "Awaiting MOFA data"
              }
            />

            <TimelineItem
              label={`Horizon ${horizonYear ?? "—"}`}
              status={
                supplyGrowthPct == null
                  ? "—"
                  : supplyGrowthPct >= 0
                  ? "Up"
                  : "Down"
              }
              title="Projected Supply"
              detail={
                horizonYear
                  ? `${formatTonnes(nationalProjected)} t projected nationally · ${pct(supplyGrowthPct)} vs latest actual`
                  : "Awaiting forecast"
              }
            />

            <TimelineItem
              label="Demand"
              status={
                demandGrowthPct == null
                  ? "—"
                  : demandGrowthPct >= 0
                  ? "Rising"
                  : "Falling"
              }
              title="Projected Consumption"
              detail={
                projectedDemandNorm != null && projectedDemandEcon != null
                  ? `Norm ${formatTonnes(projectedDemandNorm)} t · Econ ${formatTonnes(projectedDemandEcon)} t (population × per-capita ± price elasticity)`
                  : projectedDemandNorm != null
                  ? `${formatTonnes(projectedDemandNorm)} t (normative — population × per-capita norm)`
                  : "Insufficient FAO history for either demand model"
              }
            />

            <TimelineItem
              label="Balance"
              status={
                surplusAvg == null
                  ? "—"
                  : Math.abs(surplusAvg) < 5
                  ? "Tight"
                  : surplusAvg >= 0
                  ? "Surplus"
                  : "Gap"
              }
              title={`Projected ${horizonYear ?? "—"} Balance`}
              detail={
                surplusAvg == null
                  ? "Need both projected supply and demand"
                  : surplusNorm != null && surplusEcon != null
                  ? `${pct(surplusNorm, 0)} (normative) to ${pct(surplusEcon, 0)} (econometric) corridor — supply ${formatTonnes(projectedSupply ?? 0)} t`
                  : surplusAvg >= 10
                  ? `Comfortable surplus of ${surplusAvg.toFixed(1)}%`
                  : surplusAvg >= 0
                  ? `Tight balance — surplus of just ${surplusAvg.toFixed(1)}%`
                  : `Demand may outpace supply by ${Math.abs(surplusAvg).toFixed(1)}%`
              }
            />

            <TimelineItem
              label="Prices"
              status={priceSummary?.n_markets ? "Forecast" : "—"}
              title="Market Outlook"
              detail={
                priceSummary?.avg_pred_horizon_ghs != null
                  ? `Avg ${formatTonnes(priceSummary.avg_pred_horizon_ghs)} GH₵/100KG by ${priceSummary.horizon_date?.slice(0, 7)} across ${priceSummary.n_markets} markets`
                  : "Run the price-forecast sync to populate"
              }
              action={
                <button
                  onClick={() => {
                    setChatPrompt(
                      `What is the current retail price of ${CROP.toLowerCase()} per 100KG (or per kg) in Ghana? Search the web for the latest prices across major markets like Accra, Kumasi, Tamale, and Takoradi. Cite sources and dates.`,
                    );
                    setChatOpen(true);
                  }}
                  className="inline-flex items-center rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-muted transition-colors"
                >
                  Get current price (AI + web)
                </button>
              }
              last
            />
          </Card>

          <Card className="p-5 flex flex-col">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-semibold text-foreground">Supply vs Demand</h3>
              <span className="text-[10px] text-muted-foreground">{CROP}</span>
            </div>
            <p className="text-[10px] text-muted-foreground mb-3">
              Demand lines model direct food consumption only — feed and losses excluded.
            </p>
            <div className="h-64">
              {supplyDemandSeries.length === 0 ? (
                <div className="h-full flex items-center justify-center text-[11px] text-muted-foreground">
                  Sync FAO Food Balances
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={supplyDemandSeries} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} vertical={false} />
                    <XAxis dataKey="year" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 9 }} tickFormatter={formatTonnes} />
                    <Tooltip
                      contentStyle={{ fontSize: 11 }}
                      formatter={(v: number, n: string) => {
                        const label = n === "supply" ? "Supply"
                          : n === "forecastSupply" ? "Proj. supply"
                          : n === "demandNorm" ? "Demand (normative)"
                          : n === "demandEcon" ? "Demand (econometric)"
                          : n;
                        return [`${formatTonnes(v)} t`, label];
                      }}
                    />
                    {foodBalanceRaw.length > 0 && (
                      <ReferenceLine
                        x={foodBalanceRaw.at(-1)!.year}
                        stroke={semantic.neutral}
                        strokeDasharray="2 2"
                      />
                    )}
                    <Line type="monotone" dataKey="supply" stroke={semantic.exports} strokeWidth={2} dot={false} connectNulls={false} />
                    {/* connectNulls bridges TabPFN's 2024 gap (it forecasts
                        2025 + 2026 only) so the dashed line doesn't break. */}
                    <Line type="monotone" dataKey="forecastSupply" stroke={semantic.exports} strokeWidth={2} strokeDasharray="4 3" dot={false} connectNulls />
                    {/* Two demand model lines spanning history + forecast.
                        Same color (`up` = consumption pressure) but dashed for
                        the econometric (price-elastic) line. */}
                    <Line type="monotone" dataKey="demandNorm" stroke={semantic.up} strokeWidth={1.5} strokeDasharray="2 4" dot={false} connectNulls />
                    <Line type="monotone" dataKey="demandEcon" stroke={semantic.up} strokeWidth={2} dot={false} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
            {/* Custom 2-row legend — Recharts' built-in Legend wraps oddly with
                4 series at narrow widths and steals plot height. */}
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-muted-foreground mt-3">
              <LegendDot color={semantic.exports} label="Supply" />
              <LegendDot color={semantic.up} label="Demand (norm)" dashed />
              <LegendDot color={semantic.exports} label="Proj. supply" dashed />
              <LegendDot color={semantic.up} label="Demand (econ)" />
            </div>
            <div className="grid grid-cols-2 gap-2 mt-3">
              <Pill
                label="Proj. supply"
                value={projectedSupply ? `${formatTonnes(projectedSupply)} t` : "—"}
                variant="muted"
              />
              <Pill
                label={surplusAvg != null && surplusAvg < 0 ? "Food gap" : "Food surplus"}
                value={surplusAvg != null ? `${Math.abs(surplusAvg).toFixed(0)}%` : "—"}
                variant="solid"
              />
            </div>
          </Card>
          </div>
        </div>
      </div>
    </div>

    {/* Rendered OUTSIDE the animated wrapper. The wrapper has
        `animate-fade-in`, whose keyframe leaves a `transform` value applied,
        which would establish a containing block and pin the fixed-positioned
        chat panel inside the page rather than the viewport. */}
    <ChatPanel
      open={chatOpen}
      crop={CROP}
      region={selectedRegion}
      initialPrompt={chatPrompt}
      onClose={() => setChatOpen(false)}
    />
    </>
  );
}

// ── Subcomponents (lifted from /map) ─────────────────────────────────────────

function Tile({
  eyebrow,
  value,
  unit,
  sub,
  accent = false,
}: {
  eyebrow: string;
  value: string;
  unit: string;
  sub: string;
  accent?: boolean;
}) {
  return (
    <Card className="relative overflow-hidden p-4">
      <div className={`absolute top-0 inset-x-0 h-0.5 ${accent ? "bg-foreground" : "bg-foreground/20"}`} />
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
        {eyebrow}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-2xl font-bold tabular-nums leading-none text-foreground">{value}</span>
        <span className="text-[11px] text-muted-foreground">{unit}</span>
      </div>
      <div className="text-[10px] text-muted-foreground mt-2">{sub}</div>
    </Card>
  );
}

function TimelineItem({
  label,
  status,
  title,
  detail,
  action,
  last = false,
}: {
  label: string;
  status: string;
  title: string;
  detail: string;
  /** Optional secondary action rendered under the detail text (e.g. a button
   *  that opens the chat panel with a pre-filled question). */
  action?: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div className="relative flex gap-3 pb-5">
      <div className="flex flex-col items-center pt-1">
        <span className="w-2 h-2 rounded-full bg-foreground" />
        {!last && <span className="flex-1 w-px bg-border mt-1.5" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
          <span className="text-[10px] font-medium text-muted-foreground">{status}</span>
        </div>
        <div className="text-sm font-medium text-foreground mt-0.5">{title}</div>
        <div className="text-[11px] text-muted-foreground mt-0.5">
          {detail}
          {action && <span className="ml-1.5 align-middle">{action}</span>}
        </div>
      </div>
    </div>
  );
}

function Pill({
  label,
  value,
  variant,
}: {
  label: string;
  value: string;
  variant: "muted" | "solid";
}) {
  const cls = variant === "solid" ? "bg-foreground text-background" : "bg-muted text-foreground";
  return (
    <div className={`rounded-lg px-3 py-2 ${cls}`}>
      <div className="text-[10px] font-medium opacity-70">{label}</div>
      <div className="text-sm font-bold tabular-nums mt-0.5">{value}</div>
    </div>
  );
}

function LegendDot({
  color,
  label,
  dashed = false,
}: {
  color: string;
  label: string;
  dashed?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span
        className="w-3 h-px shrink-0"
        style={{
          borderTop: `2px ${dashed ? "dashed" : "solid"} ${color}`,
        }}
      />
      <span className="truncate">{label}</span>
    </div>
  );
}
