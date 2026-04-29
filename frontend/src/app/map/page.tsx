"use client";

import { useEffect, useState } from "react";
import {
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
import { ChatPanel } from "@/components/dashboard/ChatPanel";
import { PageSkeleton } from "@/components/dashboard/PageSkeleton";
import { RegionalMap } from "@/components/dashboard/RegionalMap";
import { CHART_GRID_STROKE, semantic } from "@/lib/design-tokens";
import { getTrackerCrops, getFaoFoodBalances, getGssCropProduction, getPriceSummary } from "@/lib/api";

type Layer = "production" | "yield";

const LAYER_OPTIONS = [
  { value: "production", label: "Production" },
  { value: "yield", label: "Yield" },
] as const;

function formatTonnes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toFixed(0);
}

export default function LandingPage() {
  // Selection persists across refreshes via ?crop=. We hydrate from the URL
  // in a useEffect (not a useState initializer) so the SSR'd HTML and the
  // first client render both start from the literal default — anything else
  // would trip Next.js's hydration check.
  const [crop, setCrop] = useState<string>("Maize");
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("crop");
    if (fromUrl) setCrop(fromUrl);
  }, []);
  const [layer, setLayer] = useState<Layer>("production");
  const [crops, setCrops] = useState<string[]>([]);
  const [foodBalance, setFoodBalance] = useState<{ year: number; supply: number; demand: number }[]>([]);
  const [nationalProd, setNationalProd] = useState<{ value: number; year: number | null }>({ value: 0, year: null });
  const [topMover, setTopMover] = useState<{ name: string; pct: number } | null>(null);
  // Region selected on the map. Auto-opens the chat panel scoped to that
  // region so users can drill into local context — same UX as /forecast.
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  // Drives the initial-load skeleton; flips when the tracker-crops list
  // (the cheapest fetch and a precondition for the crop selector) resolves.
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getTrackerCrops()
      .then(setCrops)
      .finally(() => setLoaded(true));
  }, []);

  // Mirror selection back to URL.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("crop") !== crop) {
      url.searchParams.set("crop", crop);
      window.history.replaceState(null, "", url.toString());
    }
  }, [crop]);

  // Per-crop national production (latest year, GSS sum across regions)
  useEffect(() => {
    let cancelled = false;
    getGssCropProduction({ crop, element: "Production", limit: 5000 }).then(({ data }) => {
      if (cancelled) return;
      const byYear: Record<number, number> = {};
      for (const r of data) {
        if (r.value != null) byYear[r.year] = (byYear[r.year] ?? 0) + r.value;
      }
      const years = Object.keys(byYear).map(Number).sort();
      const latest = years.at(-1);
      setNationalProd({ value: latest ? byYear[latest] : 0, year: latest ?? null });
    });
    return () => { cancelled = true; };
  }, [crop]);

  // Supply vs Demand from FAO Food Balances (Production vs Domestic Supply)
  useEffect(() => {
    let cancelled = false;
    getFaoFoodBalances(crop, undefined, 500, 0).then(({ data }) => {
      if (cancelled) return;
      const byYear: Record<number, { supply: number; demand: number }> = {};
      for (const r of data) {
        if (!byYear[r.year]) byYear[r.year] = { supply: 0, demand: 0 };
        const el = (r.element ?? "").toLowerCase();
        if (el === "production") byYear[r.year].supply = r.value;
        // Demand proxy = food + losses + feed (consumption-side)
        if (el === "food" || el === "losses" || el === "feed") {
          byYear[r.year].demand = (byYear[r.year].demand ?? 0) + r.value;
        }
      }
      const series = Object.entries(byYear)
        .map(([year, vals]) => ({ year: Number(year), ...vals }))
        .filter((d) => d.supply > 0 || d.demand > 0)
        .sort((a, b) => a.year - b.year)
        .slice(-12);
      setFoodBalance(series);
    });
    return () => { cancelled = true; };
  }, [crop]);

  // Top market mover across all commodities (overall context, not crop-specific)
  useEffect(() => {
    getPriceSummary().then((summaries) => {
      const movers = summaries
        .filter((s) => s.price_change_pct != null && Number.isFinite(s.price_change_pct))
        .sort((a, b) => Math.abs(b.price_change_pct ?? 0) - Math.abs(a.price_change_pct ?? 0));
      const top = movers[0];
      setTopMover(top ? { name: top.commodity_name, pct: top.price_change_pct ?? 0 } : null);
    });
  }, []);

  const cropOptions = crops.map((c) => ({ value: c, label: c }));

  // Supply / Demand surplus & gap (latest year)
  const latestBalance = foodBalance.at(-1);
  const surplusPct = latestBalance && latestBalance.demand > 0
    ? ((latestBalance.supply - latestBalance.demand) / latestBalance.demand) * 100
    : null;

  // ── Derived timeline metrics ──────────────────────────────────────────────
  // Year-over-year supply change from food balance trend.
  const yoySupplyPct = (() => {
    if (foodBalance.length < 2) return null;
    const a = foodBalance.at(-2)!;
    const b = foodBalance.at(-1)!;
    if (a.supply <= 0) return null;
    return ((b.supply - a.supply) / a.supply) * 100;
  })();

  // 5-year average supply for context vs latest year.
  const fiveYearAvgSupply = (() => {
    const recent = foodBalance.slice(-6, -1);
    if (recent.length === 0) return null;
    return recent.reduce((s, d) => s + d.supply, 0) / recent.length;
  })();
  const vsAvgPct = fiveYearAvgSupply && latestBalance
    ? ((latestBalance.supply - fiveYearAvgSupply) / fiveYearAvgSupply) * 100
    : null;

  // Ghana agricultural calendar — current season hint based on month.
  // Computed in an effect to avoid SSR/client mismatch at month boundaries.
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

  if (!loaded) {
    return <PageSkeleton />;
  }

  return (
    <>
    <div className="space-y-5 animate-fade-in">
      {/* Page header */}
      <div className="pb-4 border-b border-border">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
          History
        </div>
        <h1 className="text-2xl font-bold text-foreground leading-tight">
          Historical Outlook
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          Reported production, yield, and food-balance trends by region.
        </p>
      </div>

      {/* ── Two-column shell: toolbar lives inside the left column so the
            right rail's top edge aligns with the Production/Yield toggle.
            items-start (not stretch) so the right rail keeps its natural
            height — required for sticky positioning to engage. */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-5 xl:items-start">
        {/* Left column: toolbar + map + tiles */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2 flex-wrap">
            <SearchableSelect
              options={cropOptions}
              value={crop}
              onValueChange={setCrop}
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
            </div>
          </div>
          <Card className="overflow-hidden p-0 h-[700px]">
            <div className="h-full bg-muted/30">
              <RegionalMap
                crop={crop}
                metric={layer}
                onRegionSelect={(region) => {
                  setSelectedRegion(region);
                  if (region) setChatOpen(true);
                }}
              />
            </div>
          </Card>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Tile
              eyebrow="National Production"
              value={`${formatTonnes(nationalProd.value)}`}
              unit="tonnes"
              sub={nationalProd.year ? `${crop}, ${nationalProd.year}` : "No data"}
              accent
            />
            <Tile
              eyebrow="Supply / Demand"
              value={surplusPct == null ? "—" : `${surplusPct >= 0 ? "+" : ""}${surplusPct.toFixed(1)}%`}
              unit={surplusPct != null && surplusPct >= 0 ? "surplus" : "gap"}
              sub={latestBalance ? `${crop}, ${latestBalance.year}` : "No data"}
            />
            <Tile
              eyebrow="Top Market Mover"
              value={topMover ? `${topMover.pct >= 0 ? "+" : ""}${topMover.pct.toFixed(1)}%` : "—"}
              unit={topMover?.name ?? "no data"}
              sub="WFP latest month change"
            />
          </div>
        </div>

        {/* Right rail — sticky at top-20 so it stays in view as the page
            scrolls. `self-start` keeps it at its natural height inside the
            grid (otherwise items-stretch fills the column and breaks
            sticky). No max-height/overflow — clamping the rail to viewport
            height clips long content (timeline + chart total >~800px on
            standard laptops); letting it run natural means anything past
            the fold is reachable by scrolling the page once. Same approach
            as /forecast's sticky rail. */}
        <div className="flex flex-col gap-4 xl:sticky xl:top-20 xl:self-start">
          <Card className="p-5 min-h-[420px]">
            <h3 className="text-sm font-semibold text-foreground mb-4">Outlook Timeline</h3>

            <TimelineItem label="This month" status={seasonNote}
              title="Current Season"
              detail={nationalProd.year
                ? `${formatTonnes(nationalProd.value)} t produced nationally (${nationalProd.year})`
                : "Awaiting GSS data"}
            />

            <TimelineItem label="Year-over-year" status={yoySupplyPct == null ? "—" : yoySupplyPct >= 0 ? "Up" : "Down"}
              title="Supply Change"
              detail={yoySupplyPct == null
                ? "Need at least 2 years of FAO data"
                : `${yoySupplyPct >= 0 ? "+" : ""}${yoySupplyPct.toFixed(1)}% vs ${latestBalance!.year - 1}, ${latestBalance!.supply > 0 ? formatTonnes(latestBalance!.supply) + " t total" : "no supply"}`}
            />

            <TimelineItem label="Vs 5-year avg" status={vsAvgPct == null ? "—" : Math.abs(vsAvgPct) < 5 ? "Stable" : vsAvgPct >= 0 ? "Above trend" : "Below trend"}
              title="Long-term Position"
              detail={vsAvgPct == null
                ? "Insufficient historical data"
                : `${vsAvgPct >= 0 ? "+" : ""}${vsAvgPct.toFixed(1)}% versus prior 5-year average supply`}
            />

            <TimelineItem label="Next quarter" status="Watch"
              title="Price Drift"
              detail={topMover
                ? `${topMover.name} leading ${topMover.pct >= 0 ? "+" : ""}${topMover.pct.toFixed(1)}% month-over-month at retail`
                : "Markets stable across tracked commodities"}
            />

            <TimelineItem label="Next year" status="Forecast"
              title="Supply Outlook"
              detail={surplusPct == null
                ? "Insufficient FAO Food Balance data to project"
                : surplusPct >= 10
                  ? `Surplus of ${surplusPct.toFixed(1)}% expected to hold`
                  : surplusPct >= 0
                    ? `Tight balance — surplus of just ${surplusPct.toFixed(1)}%`
                    : `Demand may outpace supply by ${Math.abs(surplusPct).toFixed(1)}%`}
              last
            />
          </Card>

          <Card className="p-5 min-h-[320px]">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-foreground">Supply vs Demand</h3>
              <span className="text-[10px] text-muted-foreground">{crop}</span>
            </div>
            <div className="h-56">
              {foodBalance.length === 0 ? (
                <div className="h-full flex items-center justify-center text-[11px] text-muted-foreground">
                  Sync FAO Food Balances
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={foodBalance} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} vertical={false} />
                    <XAxis dataKey="year" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 9 }} tickFormatter={formatTonnes} />
                    <Tooltip
                      contentStyle={{ fontSize: 11 }}
                      formatter={(v: number, n: string) => [`${formatTonnes(v)} t`, n]}
                    />
                    <Line type="monotone" dataKey="supply" name="Supply" stroke={semantic.exports} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="demand" name="Demand" stroke={semantic.up} strokeWidth={2} strokeDasharray="3 3" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 mt-3">
              <Pill label="Supply" value={latestBalance ? `${formatTonnes(latestBalance.supply)} t` : "—"} variant="muted" />
              <Pill label={surplusPct != null && surplusPct < 0 ? "Demand Gap" : "Surplus"}
                value={surplusPct != null ? `${Math.abs(surplusPct).toFixed(1)}%` : "—"}
                variant="solid" />
            </div>
          </Card>
        </div>
      </div>
    </div>

    {/* Rendered OUTSIDE the animated wrapper. `animate-fade-in`'s keyframe
        leaves a `transform` value applied, which establishes a containing
        block and pins fixed-positioned descendants inside the page rather
        than the viewport. Same fix used on /forecast and /. */}
    <ChatPanel
      open={chatOpen}
      crop={crop}
      region={selectedRegion}
      onClose={() => setChatOpen(false)}
    />
    </>
  );
}

// ── Subcomponents ──────────────────────────────────────────────────────────

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
  last = false,
}: {
  label: string;
  status: string;
  title: string;
  detail: string;
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
        <div className="text-[11px] text-muted-foreground mt-0.5">{detail}</div>
      </div>
    </div>
  );
}

function Pill({ label, value, variant }: { label: string; value: string; variant: "muted" | "solid" }) {
  const cls =
    variant === "solid"
      ? "bg-foreground text-background"
      : "bg-muted text-foreground";
  return (
    <div className={`rounded-lg px-3 py-2 ${cls}`}>
      <div className="text-[10px] font-medium opacity-70">{label}</div>
      <div className="text-sm font-bold tabular-nums mt-0.5">{value}</div>
    </div>
  );
}
