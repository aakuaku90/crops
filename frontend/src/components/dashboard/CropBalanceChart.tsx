"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import {
  AreaChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
  ComposedChart,
} from "recharts";
import { Card } from "@/components/ui/card";
import { semantic, palette, CHART_GRID_STROKE } from "@/lib/design-tokens";

/**
 * Per-crop food balance chart. Self-contained — accepts the raw data slices
 * it needs and computes its own per-year timeseries with all 6 series:
 *   Production · Domestic Use · Demand (normative) · Demand (econometric)
 *   · Imports · Exports
 *
 * Used in two places: the trending-crop hero on the Signals page (full size,
 * with header + drill-down link) and the /crops grid (compact variant).
 */
export interface CropBalanceData {
  crop: string;
  /**
   * Year-by-year history for THIS crop. supply = production tonnes; demand =
   * food + feed + losses (apparent consumption); food = food-element only
   * (drives normative per-capita projection).
   */
  history: { year: number; supply: number; demand: number; imports: number; exports: number; food: number }[];
  /** Producer price LCU/tonne keyed by year, forward-filled. */
  producerPrices: Record<number, number>;
  /** Ghana total population in absolute people, keyed by year. */
  population: Record<number, number>;
  /**
   * Optional model-predicted production (tonnes) keyed by year. When supplied,
   * the chart draws a dashed line for these years so users see the actual
   * trajectory continuing into the forecast horizon. The seam year (last
   * actual) is copied into the predicted line so the two visually connect.
   */
  predictedProduction?: Record<number, number>;
}

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

function formatTonnes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toFixed(0);
}

/**
 * Look up the producer price for a given year, falling back to the most
 * recent prior year with a known price. Bridges the gap when FAO's
 * `Producer Price (LCU/tonne)` series ends before the food-balance series
 * (typical: producer prices stop ~2022 while balances run through 2023).
 * Returns null only if no prior price exists at all.
 */
function priceForYear(prices: Record<number, number>, year: number): number | null {
  if (prices[year] != null) return prices[year];
  const knownYears = Object.keys(prices).map(Number).filter((y) => y <= year);
  if (knownYears.length === 0) return null;
  return prices[Math.max(...knownYears)] ?? null;
}

export function buildCropChartData(d: CropBalanceData) {
  // FAO food balances arrive in 1000-tonne units; predictedProduction (TabPFN)
  // arrives in tonnes. Convert balances to tonnes so all series share a scale.
  const FBS_TO_TONNES = 1000;

  // Step 1: per-capita norm from the most-recent 5 years where both food
  // and population are present. Used for the normative demand projection.
  const yearsForNorm = d.history
    .filter((h) => d.population[h.year] && h.food > 0)
    .sort((a, b) => b.year - a.year)
    .slice(0, 5);
  const perCapitaNorm = yearsForNorm.length > 0
    ? yearsForNorm.reduce(
        (s, h) => s + (h.food * 1_000_000) / d.population[h.year],
        0,
      ) / yearsForNorm.length
    : 0;

  // Step 2: fit log-linear OLS for econometric demand.
  // ln(food_per_capita) = α + β · ln(price)
  const xs: number[] = [];
  const ys: number[] = [];
  for (const h of d.history) {
    const pop = d.population[h.year];
    const price = priceForYear(d.producerPrices, h.year);
    if (!pop || !price || h.food <= 0) continue;
    xs.push(Math.log(price));
    ys.push(Math.log((h.food * 1_000_000) / pop));
  }
  const fit = xs.length >= 5 ? olsSimpleLinear(xs, ys) : null;

  // Step 3: assemble per-year rows.
  // Build a CONTINUOUS year range from the earliest historical year through
  // the latest predicted year. Without this, gap years between FAO history
  // and TabPFN forecasts (e.g. 2024 when FAO ends at 2023 and predictions
  // start at 2025) get dropped from the row set, and the x-axis skips that
  // tick entirely. Filling the gap with null-valued rows keeps the axis
  // continuous; series with `connectNulls` still bridge the visual gap.
  const historyByYear = new Map(d.history.map((h) => [h.year, h]));
  const predictedYears = d.predictedProduction
    ? Object.keys(d.predictedProduction).map(Number)
    : [];
  const knownYears = [...d.history.map((h) => h.year), ...predictedYears];
  const allYears = knownYears.length === 0
    ? []
    : Array.from(
        { length: Math.max(...knownYears) - Math.min(...knownYears) + 1 },
        (_, i) => Math.min(...knownYears) + i,
      );

  // Last historical year with production reported — used to bridge the seam
  // so the dashed predicted line connects visually to the solid actual line.
  const lastActualYear = [...d.history]
    .filter((h) => h.supply > 0)
    .map((h) => h.year)
    .sort((a, b) => b - a)[0];
  const lastActualValue = lastActualYear != null
    ? (historyByYear.get(lastActualYear)?.supply ?? 0) * FBS_TO_TONNES || null
    : null;

  return allYears
    .slice(-15)
    .map((year) => {
      const h = historyByYear.get(year);
      const pop = d.population[year];
      const price = priceForYear(d.producerPrices, year);
      // Demand series come from pop × (kg/person) → tonnes directly.
      const demand = pop ? (pop * perCapitaNorm) / 1000 : 0;
      let demandEcon = 0;
      if (fit && pop && price) {
        const kgPerPerson = Math.exp(fit.intercept + fit.slope * Math.log(price));
        demandEcon = (kgPerPerson * pop) / 1000;
      }
      // Predicted production: TabPFN value if this is a forecast year;
      // copy of actual at the seam so the dashed line starts where the solid
      // one ends. null elsewhere keeps the line out of pre-forecast years.
      let predictedProduction: number | null = null;
      if (d.predictedProduction?.[year] != null) {
        predictedProduction = d.predictedProduction[year];
      } else if (year === lastActualYear && lastActualValue != null && predictedYears.length > 0) {
        predictedProduction = lastActualValue;
      }
      return {
        year,
        production: h?.supply != null ? h.supply * FBS_TO_TONNES : null,
        domesticUse: h?.demand != null ? h.demand * FBS_TO_TONNES : null,
        demand,
        demandEcon,
        imports: h?.imports != null ? h.imports * FBS_TO_TONNES : null,
        exports: h?.exports != null ? h.exports * FBS_TO_TONNES : null,
        predictedProduction,
      };
    });
}

interface Props {
  data: CropBalanceData;
  /** Optional eyebrow text above the title (e.g. "Trending crop"). */
  eyebrow?: string;
  /** Optional drill-down link rendered as a button below the chart. */
  drillDown?: { href: string; label: string };
  /** Compact variant for grid layouts: smaller chart, no legend. */
  compact?: boolean;
}

export function CropBalanceChart({ data, eyebrow, drillDown, compact = false }: Props) {
  const series = useMemo(() => buildCropChartData(data), [data]);
  // Latest = most recent entry with ANY production value (actual OR forecast).
  // For maize the chart now extends through 2026 via predictedProduction; we
  // want the header to surface that forecast value rather than the last 2023
  // actual.
  const latest = [...series].reverse().find(
    (r) => r.production != null || r.predictedProduction != null,
  );
  const latestProd = latest?.production ?? latest?.predictedProduction ?? null;
  const isForecast = latest?.production == null && latest?.predictedProduction != null;
  // Prior = last entry strictly before `latest` with any production. Used for
  // the YoY % shown next to the headline number.
  const latestIdx = latest ? series.indexOf(latest) : -1;
  const prior = latestIdx > 0
    ? [...series.slice(0, latestIdx)]
        .reverse()
        .find((r) => r.production != null || r.predictedProduction != null)
    : undefined;
  const priorProd = prior?.production ?? prior?.predictedProduction ?? null;
  const prodYoY = latestProd != null && priorProd != null && priorProd > 0
    ? ((latestProd - priorProd) / priorProd) * 100
    : null;
  const surplusPct = latestProd != null && latest && latest.demand > 0
    ? ((latestProd - latest.demand) / latest.demand) * 100
    : null;

  return (
    <Card className="overflow-hidden">
      <div className={`grid grid-cols-2 gap-x-4 gap-y-1 px-5 ${compact ? "pt-4" : "pt-5"} items-baseline`}>
        <div>
          {eyebrow && (
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
              {eyebrow}
            </div>
          )}
          <div className={`${compact ? "text-sm" : "text-base"} font-semibold text-foreground`}>
            {data.crop}
          </div>
        </div>
        <div className="text-right flex items-baseline justify-end gap-2">
          <span className={`${compact ? "text-base" : "text-xl"} font-bold tabular-nums text-foreground leading-none`}>
            {latestProd != null ? `${formatTonnes(latestProd)} t` : "—"}
          </span>
          {prodYoY != null && (
            <span
              className="text-xs font-semibold tabular-nums flex items-center gap-0.5"
              style={{ color: prodYoY >= 0 ? semantic.down : semantic.up }}
            >
              {prodYoY >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
              {prodYoY >= 0 ? "+" : ""}{prodYoY.toFixed(1)}%
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground">
          Production · Domestic Use · Demand · Trade flows
        </div>
        <div className="text-right text-xs text-muted-foreground">
          {latest ? `${isForecast ? "forecast" : "as of"} ${latest.year}` : ""}
          {surplusPct != null && (
            <>
              {" · "}
              <span style={{ color: surplusPct >= 0 ? semantic.down : semantic.up }}>
                {surplusPct >= 0 ? "+" : ""}{surplusPct.toFixed(1)}% {surplusPct >= 0 ? "surplus" : "gap"}
              </span>
            </>
          )}
        </div>
      </div>

      <div className={`${compact ? "h-56" : "h-72"} mt-2 px-5`}>
        {series.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
            No data for this crop
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={series} margin={{ top: 4, right: 0, left: -10, bottom: 4 }}>
              <defs>
                <linearGradient id={`prodGradient-${data.crop}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={palette.slate[800]} stopOpacity={0.20} />
                  <stop offset="100%" stopColor={palette.slate[800]} stopOpacity={0} />
                </linearGradient>
                <linearGradient id={`forecastGradient-${data.crop}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={palette.grain[400]} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={palette.grain[400]} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} vertical={false} />
              <XAxis dataKey="year" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis
                tick={{ fontSize: 10 }}
                tickFormatter={formatTonnes}
                width={42}
              />
              <Tooltip
                contentStyle={{ fontSize: 11 }}
                formatter={(v: number, n: string) => [`${formatTonnes(v)} t`, n]}
              />
              <Legend wrapperStyle={{ fontSize: 10 }} iconType="line" iconSize={10} />
              <Area
                type="monotone"
                dataKey="production"
                name="Production"
                stroke={palette.slate[900]}
                strokeWidth={2}
                fill={`url(#prodGradient-${data.crop})`}
                connectNulls={false}
              />
              {/* Optional model-predicted production — amber fill marks the
                  forecast region distinctly from the slate actuals area, with
                  a dashed line on top for the trajectory. connectNulls bridges
                  any gap year so the forecast draws cleanly from the seam
                  through horizon. */}
              <Area
                type="monotone"
                dataKey="predictedProduction"
                stroke="none"
                fill={`url(#forecastGradient-${data.crop})`}
                connectNulls
                legendType="none"
                tooltipType="none"
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="predictedProduction"
                name="Production (forecast)"
                stroke={palette.grain[500]}
                strokeWidth={2}
                strokeDasharray="4 3"
                dot={{ r: 2, fill: palette.grain[500] }}
                connectNulls
              />
              <Line
                type="monotone"
                dataKey="domesticUse"
                name="Domestic Use"
                stroke={palette.slate[700]}
                strokeWidth={1.5}
                strokeDasharray="4 3"
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="demand"
                name="Demand (normative)"
                stroke={semantic.up}
                strokeWidth={1.5}
                strokeDasharray="2 4"
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="demandEcon"
                name="Demand (econometric)"
                stroke={semantic.up}
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="imports"
                name="Imports"
                stroke={palette.slate[500]}
                strokeWidth={1.25}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="exports"
                name="Exports"
                stroke={semantic.exports}
                strokeWidth={1.25}
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {drillDown && (
        <Link
          href={drillDown.href}
          className="border-t border-border block px-5 py-3 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors flex items-center justify-between"
        >
          <span>{drillDown.label}</span>
          <ArrowUpRight className="w-3.5 h-3.5" />
        </Link>
      )}
    </Card>
  );
}
