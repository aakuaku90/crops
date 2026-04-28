"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ArrowDownRight, ArrowRight, Minus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { CropBalanceChart } from "@/components/dashboard/CropBalanceChart";
import { ChatPanel } from "@/components/dashboard/ChatPanel";
import { semantic, palette } from "@/lib/design-tokens";
import {
  getPriceSummary,
  getFaoFoodBalances,
  getTrackerCrops,
  getFaoHealthyDietCost,
  getFaoProducerPrices,
  getPriceTimeseries,
  getFaoCropProduction,
  getFaoTrade,
  getFaoFoodSecurity,
  getFaoPopulation,
  getMaizePredictions,
  type PriceSummary,
  type FaoHealthyDietCost,
  type FaoFoodSecurity,
} from "@/lib/api";

interface BalanceSignal {
  crop: string;
  surplusPct: number;
  supply: number;
  demand: number;
  imports: number;
  year: number;
  /** Last 10 years of surplus % for sparklines. */
  series: number[];
  /** Last 10 years of import dependency % for sparklines. */
  importSeries: number[];
  /** Full year-by-year history for cross-crop aggregation. `food` is the
      Food-only element (humans consume), used for normative demand. */
  history: { year: number; supply: number; demand: number; imports: number; exports: number; food: number }[];
}

interface ProductionSignal {
  crop: string;
  latestYear: number;
  latestValue: number;     // tonnes
  yoyPct: number;
  series: number[];        // last 10 years for sparkline
}

interface YieldSignal {
  crop: string;
  latestYear: number;
  latestYield: number;     // tonnes per hectare
  yoyPct: number;
  series: number[];        // last 10 years yield for sparkline
}

interface TradeBalanceSignal {
  crop: string;
  latestYear: number;
  latestNet: number;       // exports − imports (tonnes)
  netShift: number;        // latest minus prior year
  series: number[];        // last 10 years net trade
}

interface SpreadSignal {
  /** The actual WFP commodity variant — "Rice (local)", "Rice (imported)", etc. */
  commodityName: string;
  /** The tracker crop it was matched to (used to look up FAO producer price). */
  crop: string;
  retailPricePerKg: number;
  producerPricePerKg: number;
  spreadPct: number;
  currency: string;
  unit: string | null;
}

const TOP_N = 5;

export default function SignalsPage() {
  const [summaries, setSummaries] = useState<PriceSummary[]>([]);
  const [balanceSignals, setBalanceSignals] = useState<BalanceSignal[]>([]);
  const [season, setSeason] = useState<{ phase: string; window: string } | null>(null);
  const [dietCost, setDietCost] = useState<FaoHealthyDietCost[]>([]);
  const [spreads, setSpreads] = useState<SpreadSignal[]>([]);
  const [productionSignals, setProductionSignals] = useState<ProductionSignal[]>([]);
  const [yieldSignals, setYieldSignals] = useState<YieldSignal[]>([]);
  const [tradeBalances, setTradeBalances] = useState<TradeBalanceSignal[]>([]);
  const [foodSecurity, setFoodSecurity] = useState<FaoFoodSecurity[]>([]);
  const [population, setPopulation] = useState<Record<number, number>>({});
  const [producerPriceHistory, setProducerPriceHistory] = useState<Record<string, Record<number, number>>>({});
  const [sparklines, setSparklines] = useState<Record<string, number[]>>({});
  // TabPFN-predicted national maize production / yield by year, plus the
  // anchor values used for forecast-vs-actual framing on the maize rows.
  // Only used on this page; /trends doesn't reference it.
  const [maizePred, setMaizePred] = useState<{
    predictedProductionByYear: Record<number, number>;
    predictedYieldByYear: Record<number, number>;
    horizonYear: number | null;
    latestActualYear: number | null;
    latestActualProduction: number | null;
    latestActualYield: number | null;
  }>({
    predictedProductionByYear: {},
    predictedYieldByYear: {},
    horizonYear: null,
    latestActualYear: null,
    latestActualProduction: null,
    latestActualYield: null,
  });

  // Chat panel — opens when any crop row in this page is clicked.
  const [chatCrop, setChatCrop] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const openChat = (crop: string) => {
    setChatCrop(crop);
    setChatOpen(true);
  };

  // ── Fetch: WFP price summary ──
  useEffect(() => {
    getPriceSummary().then(setSummaries);
  }, []);

  // ── Fetch: Healthy diet cost ──
  useEffect(() => {
    getFaoHealthyDietCost().then(setDietCost);
  }, []);

  // ── Fetch: Maize predictions (TabPFN). Drives the dashed forecast line on
  // the trending hero chart and the maize-row overrides in Production
  // Momentum + Yield Trends. ──
  useEffect(() => {
    let cancelled = false;
    getMaizePredictions({ limit: 5000 }).then(({ data }) => {
      if (cancelled) return;
      const predProdByYear: Record<number, number> = {};
      const predRowsByYear: Record<number, { yield: number; n: number }> = {};
      const actualProdByYear: Record<number, number> = {};
      const actualYieldByYear: Record<number, { y: number; n: number }> = {};
      let horizon: number | null = null;
      let latestActualYear: number | null = null;
      for (const r of data) {
        if (r.source !== "backtest") {
          if (r.pred_production != null) {
            predProdByYear[r.year] = (predProdByYear[r.year] ?? 0) + r.pred_production;
          }
          if (r.pred_yield != null) {
            const e = predRowsByYear[r.year] ?? { yield: 0, n: 0 };
            e.yield += r.pred_yield;
            e.n += 1;
            predRowsByYear[r.year] = e;
          }
          if (horizon == null || r.year > horizon) horizon = r.year;
        } else {
          if (r.actual_production != null) {
            actualProdByYear[r.year] = (actualProdByYear[r.year] ?? 0) + r.actual_production;
          }
          if (r.actual_yield != null) {
            const e = actualYieldByYear[r.year] ?? { y: 0, n: 0 };
            e.y += r.actual_yield;
            e.n += 1;
            actualYieldByYear[r.year] = e;
          }
          if (
            (r.actual_production != null || r.actual_yield != null) &&
            (latestActualYear == null || r.year > latestActualYear)
          ) {
            latestActualYear = r.year;
          }
        }
      }
      const predictedYieldByYear: Record<number, number> = {};
      for (const [y, v] of Object.entries(predRowsByYear)) {
        predictedYieldByYear[Number(y)] = v.n ? v.yield / v.n : 0;
      }
      const latestActualProduction = latestActualYear != null
        ? actualProdByYear[latestActualYear] ?? null
        : null;
      const latestActualYield = latestActualYear != null && actualYieldByYear[latestActualYear]
        ? actualYieldByYear[latestActualYear].y / actualYieldByYear[latestActualYear].n
        : null;
      setMaizePred({
        predictedProductionByYear: predProdByYear,
        predictedYieldByYear,
        horizonYear: horizon,
        latestActualYear,
        latestActualProduction,
        latestActualYield,
      });
    });
    return () => { cancelled = true; };
  }, []);

  // ── Fetch: Food balances per tracker crop (also captures imports) ──
  useEffect(() => {
    let cancelled = false;
    async function loadBalances() {
      const crops = await getTrackerCrops();
      const results = await Promise.all(
        crops.map(async (crop) => {
          const { data } = await getFaoFoodBalances(crop, undefined, 500, 0);
          // FAO bundles each crop's primary balance under "{Crop} and products"
          // and ALSO returns processed derivatives (e.g. "Maize Germ Oil") via
          // ILIKE matching. Filter to the primary item only so we don't
          // double-count. Falls back to all rows if the canonical name isn't
          // present (some crops use other labels).
          const cropLc = crop.toLowerCase();
          const primary = data.filter((r) =>
            r.item.toLowerCase() === `${cropLc} and products`,
          );
          const filtered = primary.length > 0 ? primary : data;
          const byYear: Record<number, { supply: number; demand: number; imports: number; exports: number; food: number }> = {};
          for (const r of filtered) {
            const el = (r.element ?? "").toLowerCase();
            if (!byYear[r.year]) byYear[r.year] = { supply: 0, demand: 0, imports: 0, exports: 0, food: 0 };
            if (el === "production") byYear[r.year].supply = r.value;
            if (el === "import quantity") byYear[r.year].imports = r.value;
            if (el === "export quantity") byYear[r.year].exports = r.value;
            if (el === "food") byYear[r.year].food = r.value;
            if (el === "food" || el === "losses" || el === "feed") {
              byYear[r.year].demand = (byYear[r.year].demand ?? 0) + r.value;
            }
          }
          const years = Object.entries(byYear)
            .filter(([, v]) => v.supply > 0 && v.demand > 0)
            .map(([y, v]) => ({ year: Number(y), ...v }))
            .sort((a, b) => a.year - b.year);
          const latest = years.at(-1);
          if (!latest) return null;
          const series = years.slice(-10).map(
            (y) => ((y.supply - y.demand) / y.demand) * 100,
          );
          const importSeries = years.slice(-10).map((y) => {
            const total = y.supply + y.imports;
            return total > 0 ? (y.imports / total) * 100 : 0;
          });
          return {
            crop,
            year: latest.year,
            supply: latest.supply,
            demand: latest.demand,
            imports: latest.imports,
            surplusPct: ((latest.supply - latest.demand) / latest.demand) * 100,
            series,
            importSeries,
            history: years,
          };
        }),
      );
      if (!cancelled) {
        setBalanceSignals(results.filter((x): x is BalanceSignal => x !== null));
      }
    }
    loadBalances();
    return () => { cancelled = true; };
  }, []);

  // ── Fetch: Crop production per tracker crop. Drives both Production
  // Momentum (YoY change in tonnes) and Yield Trends (production/area). ──
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const crops = await getTrackerCrops();
      const results = await Promise.all(
        crops.map(async (crop) => {
          const { data } = await getFaoCropProduction(crop, undefined, 500, 0);
          // FAO returns multiple item rows (e.g. "Maize (corn)" + "Maize and
          // products" derivatives). Keep the primary "production"-bearing
          // item, taking the most-reported one for stability.
          const cropLc = crop.toLowerCase();
          const candidates = data.filter((r) =>
            r.item.toLowerCase().includes(cropLc),
          );
          // Group by year, taking Production (in tonnes) and Area (in hectares).
          const byYear: Record<number, { prod: number; area: number }> = {};
          for (const r of candidates) {
            const el = (r.element ?? "").toLowerCase();
            if (!byYear[r.year]) byYear[r.year] = { prod: 0, area: 0 };
            if (el === "production") byYear[r.year].prod += r.value;
            if (el === "area harvested") byYear[r.year].area += r.value;
          }
          const years = Object.entries(byYear)
            .map(([y, v]) => ({ year: Number(y), ...v }))
            .filter((y) => y.prod > 0)
            .sort((a, b) => a.year - b.year);
          if (years.length < 2) return null;

          const latest = years.at(-1)!;
          const prior = years.at(-2)!;
          const prodYoY = prior.prod > 0
            ? ((latest.prod - prior.prod) / prior.prod) * 100
            : 0;

          const prodSeries = years.slice(-10).map((y) => y.prod);

          // Yield trend only if we have area data for both latest and prior.
          let yieldSig: YieldSignal | null = null;
          if (latest.area > 0 && prior.area > 0) {
            const latestYield = latest.prod / latest.area;
            const priorYield = prior.prod / prior.area;
            const yieldYoY = ((latestYield - priorYield) / priorYield) * 100;
            const yieldSeries = years
              .slice(-10)
              .filter((y) => y.area > 0)
              .map((y) => y.prod / y.area);
            yieldSig = {
              crop,
              latestYear: latest.year,
              latestYield,
              yoyPct: yieldYoY,
              series: yieldSeries,
            };
          }

          return {
            production: {
              crop,
              latestYear: latest.year,
              latestValue: latest.prod,
              yoyPct: prodYoY,
              series: prodSeries,
            } as ProductionSignal,
            yield: yieldSig,
          };
        }),
      );
      if (cancelled) return;
      setProductionSignals(results.filter((x) => x).map((x) => x!.production));
      setYieldSignals(
        results.filter((x) => x?.yield).map((x) => x!.yield!) as YieldSignal[],
      );
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // ── Fetch: Trade per tracker crop for net trade balance shifts. ──
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const crops = await getTrackerCrops();
      const results = await Promise.all(
        crops.map(async (crop) => {
          const { data } = await getFaoTrade(crop, undefined, 1000, 0);
          // Group by year: imports vs exports (quantity = tonnes).
          const byYear: Record<number, { imports: number; exports: number }> = {};
          for (const r of data) {
            const el = (r.element ?? "").toLowerCase();
            if (!byYear[r.year]) byYear[r.year] = { imports: 0, exports: 0 };
            if (el === "import quantity") byYear[r.year].imports += r.value;
            if (el === "export quantity") byYear[r.year].exports += r.value;
          }
          const years = Object.entries(byYear)
            .map(([y, v]) => ({ year: Number(y), net: v.exports - v.imports }))
            .filter((y) => y.net !== 0)
            .sort((a, b) => a.year - b.year);
          if (years.length < 2) return null;
          const latest = years.at(-1)!;
          const prior = years.at(-2)!;
          return {
            crop,
            latestYear: latest.year,
            latestNet: latest.net,
            netShift: latest.net - prior.net,
            series: years.slice(-10).map((y) => y.net),
          } as TradeBalanceSignal;
        }),
      );
      if (cancelled) return;
      setTradeBalances(results.filter((x): x is TradeBalanceSignal => x !== null));
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // ── Fetch: National food security indicators (FAO). ──
  useEffect(() => {
    getFaoFoodSecurity().then(setFoodSecurity);
  }, []);

  // ── Fetch: Ghana total population per year (FAO publishes in 1000s). ──
  // Used to compute the normative demand line (people × per-capita norm).
  useEffect(() => {
    getFaoPopulation("Total Population - Both sexes").then((rows) => {
      const map: Record<number, number> = {};
      for (const r of rows) {
        map[r.year] = r.value * 1000;
      }
      setPopulation(map);
    });
  }, []);

  // ── Fetch: Producer price histories per crop (LCU/tonne timeseries).
  // Used by the econometric demand estimation — we need own-price history
  // per crop per year so we can fit the price-elasticity coefficient.
  // FAO's annual coverage is patchy (e.g. crop X may have 2010, 2012, 2014
  // but skip 2011, 2013) — we forward-fill the gaps so every year between
  // first and last reading has a price. Without this, the aggregated
  // demand line oscillates because different crops contribute on different
  // years. ──
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const crops = await getTrackerCrops();
      const out: Record<string, Record<number, number>> = {};
      await Promise.all(
        crops.map(async (crop) => {
          const data = await getFaoProducerPrices(crop);
          const lcu = data.filter((p) => /lcu\/tonne/i.test(p.element ?? ""));
          const byYear: Record<number, number> = {};
          for (const r of lcu) {
            const year = new Date(r.start_date).getFullYear();
            if (r.value > 0) byYear[year] = r.value;
          }
          // Forward-fill missing years between min and max known year so
          // the demand aggregation has consistent crop coverage.
          const years = Object.keys(byYear).map(Number).sort((a, b) => a - b);
          if (years.length >= 2) {
            const first = years[0];
            const last = years[years.length - 1];
            let lastPrice = byYear[first];
            for (let y = first; y <= last; y++) {
              if (byYear[y] != null) lastPrice = byYear[y];
              else byYear[y] = lastPrice;
            }
          }
          out[crop] = byYear;
        }),
      );
      if (!cancelled) setProducerPriceHistory(out);
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // ── Fetch: Producer prices for spread calc.
  // We compute spread for EVERY WFP variant that has a parseable kg unit
  // and a matching FAO producer crop — so "Rice (local)" and "Rice
  // (imported)" each get their own row, "Maize" and "Maize (yellow)" each
  // get their own row, etc. No collapsing to a single representative variant.
  useEffect(() => {
    if (summaries.length === 0) return;
    let cancelled = false;
    async function loadSpreads() {
      const crops = await getTrackerCrops();
      const cropLowers = crops.map((c) => c.toLowerCase());

      // For each WFP commodity, find which tracker crop it belongs to (so we
      // know what producer price to pull). Filter out commodities with
      // non-weight units or no matching crop.
      const candidates = summaries
        .map((wfp) => {
          const kgPerUnit = parseKgPerUnit(wfp.unit);
          if (kgPerUnit == null || !wfp.latest_price) return null;
          const wfpLower = wfp.commodity_name.toLowerCase();
          const matchIdx = cropLowers.findIndex((cl) => wfpLower.includes(cl));
          if (matchIdx < 0) return null;
          return { wfp, kgPerUnit, crop: crops[matchIdx] };
        })
        .filter((c): c is { wfp: PriceSummary; kgPerUnit: number; crop: string } => c !== null);

      // Cache producer prices per crop (no point fetching twice when two WFP
      // variants share the same crop).
      const producerCache: Record<string, number | null> = {};
      async function producerFor(crop: string): Promise<number | null> {
        if (crop in producerCache) return producerCache[crop];
        const producerData = await getFaoProducerPrices(crop);
        const lcuRows = producerData
          .filter((p) => /lcu\/tonne/i.test(p.element ?? ""))
          .sort((a, b) => b.start_date.localeCompare(a.start_date));
        const value = lcuRows[0]?.value ?? null;
        producerCache[crop] = value && value > 0 ? value / 1000 : null;
        return producerCache[crop];
      }

      const results = await Promise.all(
        candidates.map(async ({ wfp, kgPerUnit, crop }) => {
          const producerPerKg = await producerFor(crop);
          if (producerPerKg == null) return null;
          const retailPerKg = wfp.latest_price / kgPerUnit;
          const spreadPct = ((retailPerKg - producerPerKg) / producerPerKg) * 100;
          if (!Number.isFinite(spreadPct)) return null;
          return {
            commodityName: wfp.commodity_name,
            crop,
            retailPricePerKg: retailPerKg,
            producerPricePerKg: producerPerKg,
            spreadPct,
            currency: wfp.currency,
            unit: wfp.unit,
          };
        }),
      );
      if (!cancelled) {
        setSpreads(results.filter((x): x is SpreadSignal => x !== null));
      }
    }
    loadSpreads();
    return () => { cancelled = true; };
  }, [summaries]);

  // ── Season ──
  useEffect(() => {
    const m = new Date().getMonth();
    setSeason(
      m >= 2 && m <= 4 ? { phase: "Major Planting", window: "March – May" }
      : m >= 5 && m <= 7 ? { phase: "Lean Season", window: "June – August" }
      : m >= 8 && m <= 10 ? { phase: "Main Harvest", window: "September – November" }
      : { phase: "Off-season", window: "December – February" },
    );
  }, []);

  // ── Movers ──
  const validMovers = summaries.filter(
    (s) => s.price_change_pct != null && Number.isFinite(s.price_change_pct),
  );
  const spikes = [...validMovers]
    .filter((s) => (s.price_change_pct ?? 0) > 0)
    .sort((a, b) => (b.price_change_pct ?? 0) - (a.price_change_pct ?? 0))
    .slice(0, TOP_N);
  const drops = [...validMovers]
    .filter((s) => (s.price_change_pct ?? 0) < 0)
    .sort((a, b) => (a.price_change_pct ?? 0) - (b.price_change_pct ?? 0))
    .slice(0, TOP_N);
  const shortages = [...balanceSignals]
    .filter((b) => b.surplusPct < 0)
    .sort((a, b) => a.surplusPct - b.surplusPct)
    .slice(0, TOP_N);
  const surpluses = [...balanceSignals]
    .filter((b) => b.surplusPct > 0)
    .sort((a, b) => b.surplusPct - a.surplusPct)
    .slice(0, TOP_N);

  // ── #1 Volatility — computed from the recent sparkline timeseries.
  // The summary's all-time min/max is unreliable (mixes units across years
  // and outlier markets), so we use the cleaned 24-month series instead.
  // Volatility = (max − min) / mean × 100 over that window.
  const volatility = useMemo(() => {
    return [...summaries]
      .map((s) => {
        const series = sparklines[s.commodity_name];
        if (!series || series.length < 4) return { ...s, volatilityPct: 0, recentMin: 0, recentMax: 0 };
        const recentMin = Math.min(...series);
        const recentMax = Math.max(...series);
        const mean = series.reduce((a, b) => a + b, 0) / series.length;
        const volatilityPct = mean > 0 ? ((recentMax - recentMin) / mean) * 100 : 0;
        return { ...s, volatilityPct, recentMin, recentMax };
      })
      .filter((s) => s.volatilityPct > 0)
      .sort((a, b) => b.volatilityPct - a.volatilityPct)
      .slice(0, TOP_N);
  }, [summaries, sparklines]);

  // ── #3 Trade dependency — top import-reliant crops ──
  const tradeDependency = useMemo(() => {
    return [...balanceSignals]
      .map((b) => {
        const total = b.supply + b.imports;
        const dependencyPct = total > 0 ? (b.imports / total) * 100 : 0;
        return { ...b, dependencyPct };
      })
      .filter((b) => b.dependencyPct > 0)
      .sort((a, b) => b.dependencyPct - a.dependencyPct)
      .slice(0, TOP_N);
  }, [balanceSignals]);

  // ── #5 Spread — sorted widest first. Card shows the first 5; remainder
  // surfaced via a "View all" drawer so the data isn't lost.
  const spreadSignals = useMemo(() => {
    return [...spreads].sort((a, b) => b.spreadPct - a.spreadPct);
  }, [spreads]);
  const [spreadDrawerOpen, setSpreadDrawerOpen] = useState(false);
  const [volatilityDrawerOpen, setVolatilityDrawerOpen] = useState(false);
  const [moversDrawerOpen, setMoversDrawerOpen] = useState(false);

  // Full sorted lists for the drawers.
  const allVolatility = useMemo(() => {
    return [...summaries]
      .map((s) => {
        const series = sparklines[s.commodity_name];
        if (!series || series.length < 4) return { ...s, volatilityPct: 0, recentMin: 0, recentMax: 0 };
        const recentMin = Math.min(...series);
        const recentMax = Math.max(...series);
        const mean = series.reduce((a, b) => a + b, 0) / series.length;
        const volatilityPct = mean > 0 ? ((recentMax - recentMin) / mean) * 100 : 0;
        return { ...s, volatilityPct, recentMin, recentMax };
      })
      .filter((s) => s.volatilityPct > 0)
      .sort((a, b) => b.volatilityPct - a.volatilityPct);
  }, [summaries, sparklines]);

  const allMovers = useMemo(() => {
    return [...validMovers].sort(
      (a, b) => Math.abs(b.price_change_pct ?? 0) - Math.abs(a.price_change_pct ?? 0),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summaries]);

  // ── #6 Production Momentum — top crops by absolute YoY production change.
  // Maize row gets swapped for TabPFN's horizon-vs-latest-actual jump so the
  // forecast surfaces alongside the historical movers.
  const productionMovers = useMemo(() => {
    const augmented = productionSignals.map((p) => {
      if (
        p.crop.toLowerCase() !== "maize" ||
        maizePred.horizonYear == null ||
        maizePred.latestActualProduction == null
      ) return p;
      const horizonProd = maizePred.predictedProductionByYear[maizePred.horizonYear];
      if (!horizonProd) return p;
      const yoyPct = ((horizonProd - maizePred.latestActualProduction) /
        maizePred.latestActualProduction) * 100;
      return {
        ...p,
        latestYear: maizePred.horizonYear,
        latestValue: horizonProd,
        yoyPct,
        series: [...p.series.slice(-7), horizonProd],
      };
    });
    return [...augmented]
      .sort((a, b) => Math.abs(b.yoyPct) - Math.abs(a.yoyPct))
      .slice(0, TOP_N);
  }, [productionSignals, maizePred]);

  // ── #7 Yield Trends — top crops by absolute YoY yield change. Same maize
  // override using TabPFN's predicted yield at horizon.
  const yieldMovers = useMemo(() => {
    const augmented = yieldSignals.map((y) => {
      if (
        y.crop.toLowerCase() !== "maize" ||
        maizePred.horizonYear == null ||
        maizePred.latestActualYield == null
      ) return y;
      const horizonYield = maizePred.predictedYieldByYear[maizePred.horizonYear];
      if (!horizonYield) return y;
      const yoyPct = ((horizonYield - maizePred.latestActualYield) /
        maizePred.latestActualYield) * 100;
      return {
        ...y,
        latestYear: maizePred.horizonYear,
        latestYield: horizonYield,
        yoyPct,
        series: [...y.series.slice(-7), horizonYield],
      };
    });
    return [...augmented]
      .sort((a, b) => Math.abs(b.yoyPct) - Math.abs(a.yoyPct))
      .slice(0, TOP_N);
  }, [yieldSignals, maizePred]);

  // ── #8 Trade Balance Shifts — biggest year-over-year change in net trade.
  // Positive shift = exports growing faster (or imports falling); negative
  // shift = trade position weakening.
  const tradeShifts = useMemo(() => {
    return [...tradeBalances]
      .sort((a, b) => Math.abs(b.netShift) - Math.abs(a.netShift))
      .slice(0, TOP_N);
  }, [tradeBalances]);

  // ── #9 Food Security Watch — pull headline indicators from FAO.
  // Each row is one national-level metric with its latest value + YoY.
  const foodSecuritySignals = useMemo(() => {
    // Items we surface, in display order. Each gets its latest reading + YoY.
    const targets = [
      { key: "Prevalence of undernourishment", suffix: "%", interpretAsRisk: true },
      { key: "Prevalence of moderate or severe food insecurity", suffix: "%", interpretAsRisk: true },
      { key: "Prevalence of severe food insecurity", suffix: "%", interpretAsRisk: true },
    ];

    // Pull % unable to afford from healthy diet cost dataset (different table).
    const pua = dietCost
      .filter((d) => /prevalence of unaffordability/i.test(d.item))
      .sort((a, b) => b.year - a.year);
    const nua = dietCost
      .filter((d) => /number of people unable to afford/i.test(d.item))
      .sort((a, b) => b.year - a.year);

    function latestFromFs(itemPattern: string) {
      const rows = foodSecurity
        .filter((r) => new RegExp(itemPattern, "i").test(r.item))
        .filter((r) => r.year_start != null)
        .sort((a, b) => (b.year_start ?? 0) - (a.year_start ?? 0));
      if (rows.length === 0) return null;
      const latest = rows[0];
      // Prior reading = first older row at least 2 years before latest.
      const prior = rows.find(
        (r) => r.year_start != null && r.year_start <= (latest.year_start ?? 0) - 1,
      );
      const yoy = prior && prior.value > 0
        ? ((latest.value - prior.value) / prior.value) * 100
        : null;
      return { value: latest.value, year_label: latest.year_label, unit: latest.unit, yoy };
    }

    const out: { label: string; sub: string; value: string; yoyPct: number | null; rowTone: "up" | "down" }[] = [];

    if (pua.length > 0) {
      const latest = pua[0];
      const prior = pua.find((d) => d.year === latest.year - 1);
      const yoy = prior && prior.value > 0
        ? ((latest.value - prior.value) / prior.value) * 100
        : null;
      out.push({
        label: "Cannot afford healthy diet",
        sub: `${latest.value.toFixed(1)}% of population (${latest.year})${yoy != null ? ` · ${yoy >= 0 ? "+" : ""}${yoy.toFixed(1)}% YoY` : ""}`,
        value: `${latest.value.toFixed(1)}%`,
        yoyPct: yoy,
        rowTone: yoy != null && yoy >= 0 ? "up" : "down",
      });
    }
    if (nua.length > 0) {
      const latest = nua[0];
      const prior = nua.find((d) => d.year === latest.year - 1);
      const yoy = prior && prior.value > 0
        ? ((latest.value - prior.value) / prior.value) * 100
        : null;
      out.push({
        label: "People unable to afford healthy diet",
        sub: `${latest.value.toFixed(1)}M people (${latest.year})${yoy != null ? ` · ${yoy >= 0 ? "+" : ""}${yoy.toFixed(1)}% YoY` : ""}`,
        value: `${latest.value.toFixed(1)}M`,
        yoyPct: yoy,
        rowTone: yoy != null && yoy >= 0 ? "up" : "down",
      });
    }
    for (const t of targets) {
      const latest = latestFromFs(t.key);
      if (!latest) continue;
      out.push({
        label: t.key,
        sub: `${latest.value.toFixed(1)}${latest.unit ?? t.suffix} (${latest.year_label})${latest.yoy != null ? ` · ${latest.yoy >= 0 ? "+" : ""}${latest.yoy.toFixed(1)}% YoY` : ""}`,
        value: `${latest.value.toFixed(1)}${t.suffix}`,
        yoyPct: latest.yoy,
        rowTone: latest.yoy != null && latest.yoy >= 0 ? "up" : "down",
      });
    }
    return out;
  }, [dietCost, foodSecurity]);

  // ── Sparkline timeseries for price lists ──
  useEffect(() => {
    if (spikes.length === 0 && drops.length === 0 && volatility.length === 0) return;
    let cancelled = false;
    const names = Array.from(
      new Set([...spikes, ...drops, ...volatility].map((s) => s.commodity_name)),
    );
    Promise.all(
      names.map(async (name) => {
        const ts = await getPriceTimeseries(name).catch(() => []);
        const byMonth: Record<string, number[]> = {};
        for (const p of ts) {
          const m = p.date.slice(0, 7);
          (byMonth[m] ??= []).push(Number(p.avg_price));
        }
        const series = Object.entries(byMonth)
          .sort(([a], [b]) => a.localeCompare(b))
          .slice(-24)
          .map(([, vals]) => vals.reduce((s, v) => s + v, 0) / vals.length);
        return [name, series] as const;
      }),
    ).then((entries) => {
      if (cancelled) return;
      setSparklines((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summaries]);

  // ── Trending crop locked to Maize on this page (the new index). The
  // /trends page still picks the biggest YoY mover dynamically. Falls back
  // to the biggest mover if Maize isn't in productionSignals yet.
  const trendingMover = useMemo(() => {
    const maize = productionSignals.find((p) => p.crop.toLowerCase() === "maize");
    if (maize) return maize;
    return [...productionSignals]
      .sort((a, b) => Math.abs(b.yoyPct) - Math.abs(a.yoyPct))[0];
  }, [productionSignals]);

  // Build the data slice CropBalanceChart needs for the trending crop. For
  // maize specifically, also pass TabPFN-predicted production by year so the
  // chart can draw a dashed forecast continuation past the last actual.
  const trendingCropData = useMemo(() => {
    if (!trendingMover) return null;
    const balance = balanceSignals.find((b) => b.crop === trendingMover.crop);
    if (!balance) return null;
    const isMaize = trendingMover.crop.toLowerCase() === "maize";
    return {
      crop: trendingMover.crop,
      history: balance.history,
      producerPrices: producerPriceHistory[trendingMover.crop] ?? {},
      population,
      predictedProduction: isMaize ? maizePred.predictedProductionByYear : undefined,
    };
  }, [trendingMover, balanceSignals, producerPriceHistory, population, maizePred]);

  // ── #4 Healthy diet cost (PPP dollar variant for international comparability) ──
  const dietCostSignal = useMemo(() => {
    const costRows = dietCost
      .filter((d) => /cost of a healthy diet.*ppp dollar/i.test(d.item))
      .sort((a, b) => b.year - a.year);
    const latest = costRows[0];
    const prior = costRows.find((d) => d.year === (latest?.year ?? 0) - 1);
    if (!latest) return null;
    const yoy = prior && prior.value > 0
      ? ((latest.value - prior.value) / prior.value) * 100
      : null;
    return { value: latest.value, year: latest.year, yoy };
  }, [dietCost]);

  const topMover = validMovers
    .slice()
    .sort((a, b) => Math.abs(b.price_change_pct ?? 0) - Math.abs(a.price_change_pct ?? 0))[0];
  const worstShortage = shortages[0];

  return (
    <>
    <div className="space-y-6 animate-fade-in">
      {/* ── Hero ───────────────────────────────────────────────────────────── */}
      <div className="pb-4 border-b border-border">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
          Today
        </div>
        <h1 className="text-2xl font-bold text-foreground leading-tight">
          Trending
        </h1>
        <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
          Where prices are moving, where supply is tight, and what season we&apos;re in.
        </p>
      </div>

      {/* ── Trending-crop hero chart ──────────────────────────────────────── */}
      {trendingCropData ? (
        <CropBalanceChart
          data={trendingCropData}
          eyebrow={`Trending crop · ${trendingMover ? `${trendingMover.yoyPct >= 0 ? "+" : ""}${trendingMover.yoyPct.toFixed(1)}% YoY production` : "biggest mover"}`}
          drillDown={{ href: "/crops", label: "See all 10 crops" }}
        />
      ) : (
        <Card className="p-12 text-center text-sm text-muted-foreground">
          Loading crop data…
        </Card>
      )}

      {/* ── Headline KPIs (4 cards) ───────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi
          eyebrow="Current Season"
          value={season?.phase ?? "—"}
          sub={season?.window ?? ""}
          accent
        />
        <Kpi
          eyebrow="Top Price Mover"
          value={topMover ? `${topMover.price_change_pct! >= 0 ? "+" : ""}${topMover.price_change_pct!.toFixed(1)}%` : "—"}
          sub={topMover?.commodity_name ?? "Awaiting WFP data"}
          tone={topMover ? (topMover.price_change_pct! >= 0 ? "up" : "down") : undefined}
        />
        <Kpi
          eyebrow="Largest Supply Gap"
          value={worstShortage ? `${worstShortage.surplusPct.toFixed(1)}%` : "—"}
          sub={worstShortage ? `${worstShortage.crop} (${worstShortage.year})` : "Awaiting FAO Food Balances"}
          tone={worstShortage ? "up" : undefined}
        />
        <Kpi
          eyebrow="Healthy Diet Cost"
          value={dietCostSignal ? `$${dietCostSignal.value.toFixed(2)}` : "—"}
          sub={dietCostSignal
            ? `PPP per person per day (${dietCostSignal.year})${dietCostSignal.yoy != null ? ` · ${dietCostSignal.yoy >= 0 ? "+" : ""}${dietCostSignal.yoy.toFixed(1)}% YoY` : ""}`
            : "Awaiting FAO CAHD"}
          tone={dietCostSignal?.yoy != null ? (dietCostSignal.yoy >= 0 ? "up" : "down") : undefined}
        />
      </div>

      {/* ── Market ticker (heatmap row) ───────────────────────────────────── */}
      {validMovers.length > 0 && (
        <Card className="overflow-hidden">
          <div className="px-5 py-3 flex items-center justify-between border-b border-border">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Market Ticker</h3>
              <p className="text-[11px] text-muted-foreground">
                Every tracked commodity, colored by its month-over-month move
              </p>
            </div>
            <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: semantic.up }} />
                Up
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: semantic.down }} />
                Down
              </span>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-px bg-border">
            {validMovers
              .slice()
              .sort((a, b) => Math.abs(b.price_change_pct ?? 0) - Math.abs(a.price_change_pct ?? 0))
              .map((s) => {
                const pct = s.price_change_pct ?? 0;
                const intensity = Math.min(Math.abs(pct) / 25, 1);
                const tone = pct >= 0 ? semantic.up : semantic.down;
                return (
                  <Link
                    key={s.commodity_name}
                    href={`/dashboard?crop=${encodeURIComponent(s.commodity_name)}`}
                    className="bg-card hover:bg-muted/50 transition-colors px-3 py-2 flex flex-col gap-0.5"
                    style={{ borderLeft: `3px solid ${tone}`, borderLeftColor: tone, opacity: 0.55 + intensity * 0.45 }}
                  >
                    <span className="text-[11px] font-medium text-foreground truncate">
                      {s.commodity_name}
                    </span>
                    <span
                      className="text-xs font-semibold tabular-nums"
                      style={{ color: tone }}
                    >
                      {pct >= 0 ? "+" : ""}{pct.toFixed(1)}%
                    </span>
                  </Link>
                );
              })}
          </div>
        </Card>
      )}

      {/* ── Signal grid ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <SignalCard
          title="Price Spikes"
          subtitle="Largest month-over-month increases in retail markets"
          empty="No spikes — prices stable across tracked commodities"
          tone="up"
          rows={spikes.map((s) => ({
            label: s.commodity_name,
            sub: `${s.currency} ${s.latest_price.toFixed(2)} / ${s.unit ?? "unit"}`,
            value: `+${(s.price_change_pct ?? 0).toFixed(1)}%`,
            href: `/dashboard?crop=${encodeURIComponent(s.commodity_name)}`,
            sparkline: sparklines[s.commodity_name],
            onClick: () => openChat(s.commodity_name),
          }))}
          footer={allMovers.length > TOP_N ? (
            <button
              onClick={() => setMoversDrawerOpen(true)}
              className="w-full px-5 py-3 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors flex items-center justify-between"
            >
              <span>View all {allMovers.length} market movers</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          ) : undefined}
        />
        <SignalCard
          title="Price Drops"
          subtitle="Largest month-over-month decreases (good for consumers, watch for producers)"
          empty="No notable drops"
          tone="down"
          rows={drops.map((s) => ({
            label: s.commodity_name,
            sub: `${s.currency} ${s.latest_price.toFixed(2)} / ${s.unit ?? "unit"}`,
            value: `${(s.price_change_pct ?? 0).toFixed(1)}%`,
            href: `/dashboard?crop=${encodeURIComponent(s.commodity_name)}`,
            sparkline: sparklines[s.commodity_name],
            onClick: () => openChat(s.commodity_name),
          }))}
          footer={allMovers.length > TOP_N ? (
            <button
              onClick={() => setMoversDrawerOpen(true)}
              className="w-full px-5 py-3 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors flex items-center justify-between"
            >
              <span>View all {allMovers.length} market movers</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          ) : undefined}
        />

        <SignalCard
          title="Most Volatile"
          subtitle="Biggest 24-month price swing vs recent mean — risk for consumers and traders"
          empty="No volatility data"
          tone="up"
          rows={volatility.map((s) => ({
            label: s.commodity_name,
            sub: `${s.currency} ${s.recentMin.toFixed(2)} – ${s.recentMax.toFixed(2)} / ${s.unit ?? "unit"} (last 24mo)`,
            value: `±${(s.volatilityPct / 2).toFixed(0)}%`,
            href: `/dashboard?crop=${encodeURIComponent(s.commodity_name)}`,
            sparkline: sparklines[s.commodity_name],
            onClick: () => openChat(s.commodity_name),
          }))}
          footer={allVolatility.length > TOP_N ? (
            <button
              onClick={() => setVolatilityDrawerOpen(true)}
              className="w-full px-5 py-3 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors flex items-center justify-between"
            >
              <span>View all {allVolatility.length} commodities</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          ) : undefined}
        />
        <SignalCard
          title="Producer–Retail Spread"
          subtitle="Gap between farmgate (FAO) and retail (WFP) prices — wider = more middleman markup"
          empty="Awaiting price data with matching units"
          tone="up"
          rows={spreadSignals.slice(0, TOP_N).map((s) => ({
            label: s.commodityName,
            sub: `Producer ${s.producerPricePerKg.toFixed(2)} → retail ${s.retailPricePerKg.toFixed(2)} ${s.currency}/kg`,
            value: `${s.spreadPct >= 0 ? "+" : ""}${s.spreadPct.toFixed(0)}%`,
            href: `/analysis/supply?crop=${encodeURIComponent(s.crop)}`,
            onClick: () => openChat(s.crop),
          }))}
          footer={spreadSignals.length > TOP_N ? (
            <button
              onClick={() => setSpreadDrawerOpen(true)}
              className="w-full px-5 py-3 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors flex items-center justify-between"
            >
              <span>View all {spreadSignals.length} variants</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          ) : undefined}
        />

        <SignalCard
          title="Production Momentum"
          subtitle="Year-over-year change in national production (FAO). Maize compares horizon TabPFN forecast to latest reported actual."
          empty="Awaiting FAO Crop Production data"
          tone="up"
          rows={productionMovers.map((p) => {
            const isMaizeForecast =
              p.crop.toLowerCase() === "maize" &&
              maizePred.horizonYear != null &&
              p.latestYear === maizePred.horizonYear;
            const sub = isMaizeForecast
              ? `${formatTonnes(p.latestValue)} t forecast in ${p.latestYear} vs ${formatTonnes(maizePred.latestActualProduction ?? 0)} t in ${maizePred.latestActualYear}`
              : `${formatTonnes(p.latestValue)} t in ${p.latestYear}`;
            return {
              label: p.crop,
              sub,
              value: `${p.yoyPct >= 0 ? "+" : ""}${p.yoyPct.toFixed(1)}%`,
              href: `/analysis/supply?crop=${encodeURIComponent(p.crop)}`,
              sparkline: p.series.length >= 2 ? p.series : undefined,
              rowTone: p.yoyPct >= 0 ? "down" : "up",
              onClick: () => openChat(p.crop),
            };
          })}
        />
        <SignalCard
          title="Yield Trends"
          subtitle="Productivity change — production ÷ area, year-over-year (FAO). Maize compares horizon TabPFN yield forecast to latest reported actual."
          empty="Awaiting FAO area + production data"
          tone="up"
          rows={yieldMovers.map((y) => {
            const isMaizeForecast =
              y.crop.toLowerCase() === "maize" &&
              maizePred.horizonYear != null &&
              y.latestYear === maizePred.horizonYear;
            const sub = isMaizeForecast
              ? `${y.latestYield.toFixed(2)} t/ha forecast in ${y.latestYear} vs ${(maizePred.latestActualYield ?? 0).toFixed(2)} in ${maizePred.latestActualYear}`
              : `${y.latestYield.toFixed(2)} t/ha in ${y.latestYear}`;
            return {
              label: y.crop,
              sub,
              value: `${y.yoyPct >= 0 ? "+" : ""}${y.yoyPct.toFixed(1)}%`,
              href: `/analysis/supply?crop=${encodeURIComponent(y.crop)}`,
              sparkline: y.series.length >= 2 ? y.series : undefined,
              rowTone: y.yoyPct >= 0 ? "down" : "up",
              onClick: () => openChat(y.crop),
            };
          })}
        />

        <SignalCard
          title="Supply Shortages"
          subtitle="Crops where domestic demand exceeds production (FAO Food Balances)"
          empty="All tracked crops in surplus"
          tone="up"
          rows={shortages.map((b) => ({
            label: b.crop,
            sub: `Year ${b.year} · supply ${formatTonnes(b.supply)} t vs demand ${formatTonnes(b.demand)} t`,
            value: `${b.surplusPct.toFixed(1)}%`,
            href: `/analysis/supply?crop=${encodeURIComponent(b.crop)}`,
            sparkline: b.series.length >= 2 ? b.series : undefined,
            onClick: () => openChat(b.crop),
          }))}
        />
        <SignalCard
          title="Surpluses"
          subtitle="Crops with excess domestic supply — export potential"
          empty="No surplus crops on record"
          tone="down"
          rows={surpluses.map((b) => ({
            label: b.crop,
            sub: `Year ${b.year} · supply ${formatTonnes(b.supply)} t vs demand ${formatTonnes(b.demand)} t`,
            value: `+${b.surplusPct.toFixed(1)}%`,
            href: `/analysis/supply?crop=${encodeURIComponent(b.crop)}`,
            sparkline: b.series.length >= 2 ? b.series : undefined,
            onClick: () => openChat(b.crop),
          }))}
        />

        <SignalCard
          title="Trade Balance Shifts"
          subtitle="Largest year-over-year change in net exports (exports − imports)"
          empty="Awaiting FAO Trade data"
          tone="up"
          rows={tradeShifts.map((t) => ({
            label: t.crop,
            sub: `Net ${formatTonnes(Math.abs(t.latestNet))} t ${t.latestNet >= 0 ? "exports" : "imports"} (${t.latestYear})`,
            value: `${t.netShift >= 0 ? "+" : ""}${formatTonnes(Math.abs(t.netShift))} t`,
            href: `/analysis/supply?crop=${encodeURIComponent(t.crop)}`,
            sparkline: t.series.length >= 2 ? t.series : undefined,
            rowTone: t.netShift >= 0 ? "down" : "up",
            onClick: () => openChat(t.crop),
          }))}
        />
        <SignalCard
          title="Food Security Watch"
          subtitle="National-level access indicators (FAO CAHD + Food Security)"
          empty="Awaiting FAO Food Security data"
          tone="up"
          rows={foodSecuritySignals.map((f) => ({
            label: f.label,
            sub: f.sub,
            value: f.value,
            href: "/fao",
            rowTone: f.rowTone,
          }))}
        />
      </div>

      {/* ── Trade dependency, full-width ──────────────────────────────────── */}
      <SignalCard
        title="Import Dependency"
        subtitle="Share of supply that's imported — rising figures signal food security risk"
        empty="No trade data available"
        tone="up"
        rows={tradeDependency.map((b) => ({
          label: b.crop,
          sub: `Year ${b.year} · ${formatTonnes(b.imports)} t imported vs ${formatTonnes(b.supply)} t produced`,
          value: `${b.dependencyPct.toFixed(0)}%`,
          href: `/analysis/supply?crop=${encodeURIComponent(b.crop)}`,
          sparkline: b.importSeries.length >= 2 ? b.importSeries : undefined,
          onClick: () => openChat(b.crop),
        }))}
      />

      {/* ── Pointer to the map ─────────────────────────────────────────────── */}
      <Link
        href="/map"
        className="block rounded-xl border border-border hover:border-foreground/30 transition-colors p-4 group"
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              Drill down
            </div>
            <h3 className="text-base font-semibold text-foreground">Historical Outlook</h3>
            <p className="text-xs text-muted-foreground mt-1">
              See where these signals are concentrated. Production and yield by Ghana region.
            </p>
          </div>
          <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
        </div>
      </Link>
    </div>

    {/* Drawers rendered OUTSIDE the animated page wrapper. The wrapper has
        `animate-fade-in`, whose keyframe leaves a `transform` value applied,
        which would establish a containing block for fixed-positioned
        descendants and pin the drawer inside the page rather than the
        viewport. Hoisting them as siblings sidesteps that. */}
    <DetailSidebar
      open={spreadDrawerOpen}
      onClose={() => setSpreadDrawerOpen(false)}
      title="Producer–Retail Spread"
      subtitle={`All ${spreadSignals.length} WFP variants with comparable producer prices`}
      rows={spreadSignals.map((s) => ({
        label: s.commodityName,
        sub: `Producer ${s.producerPricePerKg.toFixed(2)} → retail ${s.retailPricePerKg.toFixed(2)} ${s.currency}/kg (${s.unit ?? "—"})`,
        value: `${s.spreadPct >= 0 ? "+" : ""}${s.spreadPct.toFixed(0)}%`,
        href: `/analysis/supply?crop=${encodeURIComponent(s.crop)}`,
        rowTone: s.spreadPct >= 0 ? "up" : "down",
      }))}
    />
    <DetailSidebar
      open={volatilityDrawerOpen}
      onClose={() => setVolatilityDrawerOpen(false)}
      title="Most Volatile"
      subtitle={`All ${allVolatility.length} commodities ranked by 24-month price swing`}
      rows={allVolatility.map((s) => ({
        label: s.commodity_name,
        sub: `${s.currency} ${s.recentMin.toFixed(2)} – ${s.recentMax.toFixed(2)} / ${s.unit ?? "unit"} (last 24mo)`,
        value: `±${(s.volatilityPct / 2).toFixed(0)}%`,
        href: `/dashboard?crop=${encodeURIComponent(s.commodity_name)}`,
      }))}
    />
    <DetailSidebar
      open={moversDrawerOpen}
      onClose={() => setMoversDrawerOpen(false)}
      title="All Market Movers"
      subtitle={`${allMovers.length} commodities sorted by absolute month-over-month change`}
      rows={allMovers.map((s) => {
        const pct = s.price_change_pct ?? 0;
        return {
          label: s.commodity_name,
          sub: `${s.currency} ${s.latest_price.toFixed(2)} / ${s.unit ?? "unit"}`,
          value: `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`,
          href: `/dashboard?crop=${encodeURIComponent(s.commodity_name)}`,
          rowTone: (pct >= 0 ? "up" : "down") as "up" | "down",
        };
      })}
    />

    {/* Floating chat panel — opens when any crop row is clicked. */}
    <ChatPanel open={chatOpen} crop={chatCrop} onClose={() => setChatOpen(false)} />
    </>
  );
}

// ── Subcomponents ──────────────────────────────────────────────────────────

function formatTonnes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toFixed(0);
}

/**
 * Convert a WFP unit string into kilograms-per-unit so prices can be
 * normalized to GHS/kg. Returns null for non-weight units (bunches, tubers,
 * pieces) where no clean conversion exists — caller should skip these.
 *
 * Examples (taken from real WFP Ghana data):
 *   "KG"          → 1
 *   "100 KG"      → 100
 *   "91 KG"       → 91
 *   "L"           → 1   (treat litres as kg-equivalent for liquids)
 *   "30 pcs"      → null
 *   "100 Tubers"  → null
 *   "Bunch"       → null
 */
function parseKgPerUnit(unit: string | null | undefined): number | null {
  if (!unit) return null;
  const u = unit.trim().toLowerCase();
  if (u === "kg" || u === "l") return 1;
  const m = u.match(/^([\d.]+)\s*(kg|l)\b/i);
  if (m) {
    const n = Number(m[1]);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

function Kpi({
  eyebrow,
  value,
  sub,
  tone,
  accent = false,
}: {
  eyebrow: string;
  value: string;
  sub: string;
  tone?: "up" | "down";
  accent?: boolean;
}) {
  const Icon = tone === "up" ? ArrowUpRight : tone === "down" ? ArrowDownRight : null;
  const toneColor = tone === "up" ? semantic.up : tone === "down" ? semantic.down : palette.slate[700];
  return (
    <Card className="relative overflow-hidden p-4">
      <div className={`absolute top-0 inset-x-0 h-0.5 ${accent ? "bg-foreground" : "bg-foreground/20"}`} />
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
        {eyebrow}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-2xl font-bold tabular-nums leading-none text-foreground">
          {value}
        </span>
        {Icon && <Icon className="w-4 h-4" style={{ color: toneColor }} />}
      </div>
      <div className="text-[11px] text-muted-foreground mt-2 truncate">{sub}</div>
    </Card>
  );
}

interface SignalRow {
  label: string;
  sub: string;
  value: string;
  href: string;
  sparkline?: number[];
  /** Override the card's tone for this row's value (and sparkline) color. */
  rowTone?: "up" | "down";
  /** If provided, clicking the row fires this instead of navigating to href.
      Used by the Signals page to pop the chat panel. */
  onClick?: () => void;
}

function SignalCard({
  title,
  subtitle,
  empty,
  tone,
  rows,
  footer,
}: {
  title: string;
  subtitle: string;
  empty: string;
  tone: "up" | "down";
  rows: SignalRow[];
  footer?: React.ReactNode;
}) {
  const Icon = tone === "up" ? ArrowUpRight : ArrowDownRight;
  const toneColor = tone === "up" ? semantic.up : semantic.down;
  return (
    // h-full + flex-col so sibling cards (in a grid row) match height and the
    // body can grow with flex-1, pinning the footer to the bottom of the card.
    <Card className="overflow-hidden h-full flex flex-col">
      <div className="p-5 pb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <Icon className="w-3.5 h-3.5" style={{ color: toneColor }} />
        </div>
        <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
      </div>
      <div className="border-t border-border flex-1">
        {rows.length === 0 ? (
          <div className="px-5 py-8 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
            <Minus className="w-3 h-3" />
            {empty}
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r, i) => {
              const rowColor = r.rowTone
                ? (r.rowTone === "up" ? semantic.up : semantic.down)
                : toneColor;
              const inner = (
                <>
                  <span className="w-5 text-[10px] font-mono text-muted-foreground tabular-nums">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-foreground truncate">
                      {r.label}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">{r.sub}</div>
                  </div>
                  {r.sparkline && r.sparkline.length >= 2 && (
                    <Sparkline data={r.sparkline} color={rowColor} />
                  )}
                  <span
                    className="text-sm font-semibold tabular-nums shrink-0 w-16 text-right"
                    style={{ color: rowColor }}
                  >
                    {r.value}
                  </span>
                </>
              );
              const cls = "w-full flex items-center gap-3 px-5 py-3 hover:bg-muted/50 transition-colors text-left";
              return (
                <li key={`${r.label}-${i}`}>
                  {r.onClick ? (
                    <button type="button" onClick={r.onClick} className={cls}>
                      {inner}
                    </button>
                  ) : (
                    <Link href={r.href} className={cls}>
                      {inner}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {footer && <div className="border-t border-border">{footer}</div>}
    </Card>
  );
}

interface DetailRow {
  label: string;
  sub: string;
  value: string;
  href: string;
  /** Per-row tone — overrides the card's default tone. Useful when one
      list mixes positive and negative entries (e.g. the movers drawer). */
  rowTone?: "up" | "down";
}

/**
 * Right-side sidebar that slides in from the viewport edge. No backdrop and
 * no body-scroll lock — the rest of the page stays interactive. Closes on
 * the X button or the Escape key.
 */
function DetailSidebar({
  open,
  onClose,
  title,
  subtitle,
  rows,
  defaultTone = "up",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle: string;
  rows: DetailRow[];
  defaultTone?: "up" | "down";
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <aside
      className={`fixed top-0 right-0 z-50 h-screen w-full max-w-md bg-card border-l border-border shadow-xl flex flex-col transform transition-transform duration-300 ease-out ${
        open ? "translate-x-0" : "translate-x-full pointer-events-none"
      }`}
      aria-hidden={!open}
    >
      <div className="px-5 py-4 border-b border-border flex items-start justify-between gap-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            Detail
          </div>
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
        </div>
        <button
          onClick={onClose}
          className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          aria-label="Close sidebar"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        <ul className="divide-y divide-border">
          {rows.map((r, i) => {
            const t = r.rowTone ?? defaultTone;
            const color = t === "up" ? semantic.up : semantic.down;
            return (
              <li key={`${r.label}-${i}`}>
                <Link
                  href={r.href}
                  onClick={onClose}
                  className="flex items-center gap-3 px-5 py-3 hover:bg-muted/50 transition-colors"
                >
                  <span className="w-5 text-[10px] font-mono text-muted-foreground tabular-nums">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-foreground truncate">
                      {r.label}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">{r.sub}</div>
                  </div>
                  <span
                    className="text-sm font-semibold tabular-nums shrink-0 w-16 text-right"
                    style={{ color }}
                  >
                    {r.value}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const w = 64;
  const h = 22;
  const pad = 2;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const y = pad + (1 - (v - min) / range) * (h - pad * 2);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  return (
    <svg width={w} height={h} className="shrink-0" aria-hidden="true">
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
