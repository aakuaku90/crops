"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getMaizeEvaluation,
  type EvaluationResult,
  type EvaluationTargetMetrics,
  type EvaluationModelMetrics,
} from "@/lib/api";

const MODEL_LABELS: Record<string, string> = {
  tabpfn: "TabPFN",
  lightgbm: "LightGBM",
  rolling_mean: "5-yr Rolling Mean",
};

const TARGETS = [
  { key: "yield" as const, label: "Yield (mt/ha)", units: "mt/ha" },
  { key: "area" as const, label: "Area (ha)", units: "ha" },
  { key: "production" as const, label: "Production (mt)", units: "mt" },
];

const METRIC_DEFS: {
  key: keyof EvaluationModelMetrics;
  label: string;
  // Should we minimize (true) or pick the value closest to a target? For
  // bias, the goal is closest-to-zero. Otherwise: smaller is better, except
  // R² where bigger is better.
  best: "min" | "max" | "abs_min";
  format: (v: number | null, units: string) => string;
  help: string;
}[] = [
  {
    key: "rmse",
    label: "RMSE",
    best: "min",
    format: (v, u) => (v == null ? "—" : `${v.toFixed(3)} ${u}`),
    help: "Root Mean Squared Error. Penalizes large errors. Smaller = better.",
  },
  {
    key: "mae",
    label: "MAE",
    best: "min",
    format: (v, u) => (v == null ? "—" : `${v.toFixed(3)} ${u}`),
    help: "Mean Absolute Error. Robust central error. Smaller = better.",
  },
  {
    key: "smape_pct",
    label: "sMAPE %",
    best: "min",
    format: (v) => (v == null ? "—" : `${v.toFixed(1)}%`),
    help: "Symmetric Mean Absolute Percentage Error. Bounded 0–200%; doesn't explode when actuals are near zero (the way MAPE does). Smaller = better.",
  },
  {
    key: "r2",
    label: "R²",
    best: "max",
    format: (v) => (v == null ? "—" : v.toFixed(3)),
    help: "Variance explained. 1 = perfect, 0 = mean-predictor, <0 = worse than mean. Bigger = better.",
  },
  {
    key: "bias",
    label: "Bias",
    best: "abs_min",
    format: (v, u) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(3)} ${u}`),
    help: "Mean signed error. 0 = unbiased; negative = systematic under-forecast. Closest to 0 = better.",
  },
  {
    key: "mase",
    label: "MASE",
    best: "min",
    format: (v) => (v == null ? "—" : v.toFixed(3)),
    help: "Mean Absolute Scaled Error vs naive YoY. <1 beats naive; >1 worse than naive. Smaller = better.",
  },
];

function pickBest(values: (number | null)[], best: "min" | "max" | "abs_min"): number | null {
  const valid = values.filter((v): v is number => v != null);
  if (valid.length === 0) return null;
  if (best === "max") return Math.max(...valid);
  if (best === "abs_min") return valid.reduce((a, b) => (Math.abs(a) <= Math.abs(b) ? a : b));
  return Math.min(...valid);
}

export default function MaizeEvaluationPage() {
  const [data, setData] = useState<EvaluationResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getMaizeEvaluation()
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="pb-4 border-b border-border">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
          Evaluation
        </div>
        <h1 className="text-2xl font-bold text-foreground leading-tight">
          Maize Model Comparison
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          Side-by-side metrics for TabPFN, LightGBM, and the 5-yr rolling-mean baseline,
          computed on the <span className="font-semibold">common backtest set</span>: the (region, year) pairs where
          all three models have predictions. This is the apples-to-apples comparison.
        </p>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Computing metrics…</div>
      ) : data?.error ? (
        <Card className="p-6 text-sm text-destructive">{data.error}</Card>
      ) : !data ? null : (
        <>
          {/* Coverage summary — same stat-card pattern used on the prediction pages.
              Common rows = intersection of all three backtests. Per-model "own"
              counts shown for context only; metrics below are computed on the
              common set so models that ran on more data aren't favoured. */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <SummaryTile
              label="Common rows"
              value={data.common_count}
              sub="Scored on this set"
            />
            {data.models.map((m) => (
              <SummaryTile
                key={m}
                label={`${MODEL_LABELS[m] ?? m} (own)`}
                value={data.own_counts[m] ?? 0}
                sub="Total backtest rows"
              />
            ))}
          </div>

          {/* Per-target metric tables */}
          {TARGETS.map((t) => (
            <MetricTable
              key={t.key}
              targetLabel={t.label}
              units={t.units}
              metrics={data.metrics[t.key]}
              models={data.models}
            />
          ))}

          {/* Pairwise statistical tests */}
          {TARGETS.map((t) => (
            <PairTestTable
              key={t.key}
              targetLabel={t.label}
              metrics={data.metrics[t.key]}
            />
          ))}

          {/* Per-model metrics reference table */}
          <Card className="p-0 overflow-hidden">
            <CardHeader className="px-4 pt-4 pb-2">
              <CardTitle className="text-base">Metric reference</CardTitle>
              <CardDescription>What each column in the per-model tables tells you.</CardDescription>
            </CardHeader>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="text-left font-semibold tracking-wider px-3 py-2 whitespace-nowrap w-32">Metric</th>
                    <th className="text-left font-semibold tracking-wider px-3 py-2">What it tells you</th>
                  </tr>
                </thead>
                <tbody>
                  {METRIC_DEFS.map((m) => (
                    <tr key={m.key as string} className="border-t border-border">
                      <td className="px-3 py-2 font-semibold whitespace-nowrap">{m.label}</td>
                      <td className="px-3 py-2 text-muted-foreground">{m.help}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Pairwise significance reference table */}
          <Card className="p-0 overflow-hidden">
            <CardHeader className="px-4 pt-4 pb-2">
              <CardTitle className="text-base">Pairwise significance</CardTitle>
              <CardDescription>
                Each pairwise test asks: is the accuracy difference between two models real, or could it be random noise on this evaluation set? The p-value is the probability of seeing a gap this big if the models were actually equally accurate. Lower p = more confident the difference is real.
              </CardDescription>
            </CardHeader>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="text-left font-semibold tracking-wider px-3 py-2 whitespace-nowrap w-24">Marker</th>
                    <th className="text-left font-semibold tracking-wider px-3 py-2 whitespace-nowrap w-44">p-value</th>
                    <th className="text-left font-semibold tracking-wider px-3 py-2">Interpretation</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-border">
                    <td className="px-3 py-2 font-bold text-success whitespace-nowrap">***</td>
                    <td className="px-3 py-2 tabular-nums whitespace-nowrap">p &lt; 0.001</td>
                    <td className="px-3 py-2 text-muted-foreground">Highly significant. The difference is almost certainly real.</td>
                  </tr>
                  <tr className="border-t border-border">
                    <td className="px-3 py-2 font-bold text-success whitespace-nowrap">**</td>
                    <td className="px-3 py-2 tabular-nums whitespace-nowrap">p &lt; 0.01</td>
                    <td className="px-3 py-2 text-muted-foreground">Very significant.</td>
                  </tr>
                  <tr className="border-t border-border">
                    <td className="px-3 py-2 font-bold text-success whitespace-nowrap">*</td>
                    <td className="px-3 py-2 tabular-nums whitespace-nowrap">p &lt; 0.05</td>
                    <td className="px-3 py-2 text-muted-foreground">Significant. Conventional threshold for &quot;really different&quot;.</td>
                  </tr>
                  <tr className="border-t border-border">
                    <td className="px-3 py-2 font-semibold whitespace-nowrap">n.s.</td>
                    <td className="px-3 py-2 tabular-nums whitespace-nowrap">p ≥ 0.05</td>
                    <td className="px-3 py-2 text-muted-foreground">Not significant. The gap could easily be random; do not claim a winner.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function MetricTable({
  targetLabel,
  units,
  metrics,
  models,
}: {
  targetLabel: string;
  units: string;
  metrics: EvaluationTargetMetrics | undefined;
  models: string[];
}) {
  if (!metrics || metrics.error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{targetLabel}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">{metrics?.error ?? "No data."}</div>
        </CardContent>
      </Card>
    );
  }

  // Compute best value per metric column for highlighting.
  const bestPerMetric = new Map<string, number | null>();
  for (const def of METRIC_DEFS) {
    const values = models.map((m) => metrics.per_model[m]?.[def.key] ?? null);
    bestPerMetric.set(def.key as string, pickBest(values, def.best));
  }

  return (
    <Card className="p-0 overflow-hidden">
      <CardHeader className="px-4 pt-4 pb-2">
        <CardTitle className="text-base">{targetLabel}</CardTitle>
        <CardDescription>
          n = {metrics.common_n} · naïve YoY MAE ={" "}
          {metrics.naive_mae != null ? `${metrics.naive_mae.toFixed(3)} ${units}` : "—"}
        </CardDescription>
      </CardHeader>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className="text-left font-semibold tracking-wider px-3 py-2 whitespace-nowrap">Model</th>
              {METRIC_DEFS.map((m) => (
                <th key={m.key as string} className="text-right font-semibold tracking-wider px-3 py-2 whitespace-nowrap">
                  {m.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {models.map((modelKey) => {
              const m = metrics.per_model[modelKey];
              if (!m) return null;
              return (
                <tr key={modelKey} className="border-t border-border">
                  <td className="px-3 py-2 font-medium whitespace-nowrap">{MODEL_LABELS[modelKey] ?? modelKey}</td>
                  {METRIC_DEFS.map((def) => {
                    const value = m[def.key] as number | null;
                    const best = bestPerMetric.get(def.key as string);
                    const isBest = value != null && best != null && value === best;
                    return (
                      <td
                        key={def.key as string}
                        className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${
                          isBest ? "font-bold text-success" : ""
                        }`}
                      >
                        {def.format(value, units)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function PairTestTable({
  targetLabel,
  metrics,
}: {
  targetLabel: string;
  metrics: EvaluationTargetMetrics | undefined;
}) {
  if (!metrics || metrics.error || !metrics.pair_tests?.length) return null;

  return (
    <Card className="p-0 overflow-hidden">
      <CardHeader className="px-4 pt-4 pb-2">
        <CardTitle className="text-base">{targetLabel} pairwise comparison</CardTitle>
        <CardDescription>
          Diebold-Mariano-style paired test on squared errors. p &lt; 0.05 means the difference
          between the two models is statistically significant on this evaluation set.
        </CardDescription>
      </CardHeader>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className="text-left font-semibold tracking-wider px-3 py-2 whitespace-nowrap">Model A</th>
              <th className="text-left font-semibold tracking-wider px-3 py-2 whitespace-nowrap">Model B</th>
              <th className="text-right font-semibold tracking-wider px-3 py-2 whitespace-nowrap">Mean MSE diff (A−B)</th>
              <th className="text-right font-semibold tracking-wider px-3 py-2 whitespace-nowrap">t-statistic</th>
              <th className="text-right font-semibold tracking-wider px-3 py-2 whitespace-nowrap">p-value</th>
              <th className="text-left font-semibold tracking-wider px-3 py-2 whitespace-nowrap">Winner</th>
              <th className="text-left font-semibold tracking-wider px-3 py-2 whitespace-nowrap">Significance</th>
            </tr>
          </thead>
          <tbody>
            {metrics.pair_tests.map((t) => {
              const sig = t.p_value < 0.001
                ? "***"
                : t.p_value < 0.01
                  ? "**"
                  : t.p_value < 0.05
                    ? "*"
                    : "n.s.";
              return (
                <tr key={`${t.model_a}-${t.model_b}`} className="border-t border-border">
                  <td className="px-3 py-2 whitespace-nowrap">{MODEL_LABELS[t.model_a] ?? t.model_a}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{MODEL_LABELS[t.model_b] ?? t.model_b}</td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                    {t.mean_sq_diff >= 0 ? "+" : ""}
                    {t.mean_sq_diff.toFixed(4)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{t.t_statistic.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{t.p_value.toFixed(4)}</td>
                  <td className="px-3 py-2 font-medium whitespace-nowrap">
                    {t.winner === "tie" ? "tie" : (MODEL_LABELS[t.winner] ?? t.winner)}
                  </td>
                  <td className={`px-3 py-2 whitespace-nowrap ${sig === "n.s." ? "text-muted-foreground" : "text-success font-semibold"}`}>
                    {sig}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function SummaryTile({ label, value, sub }: { label: string; value: number | string; sub: string }) {
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
