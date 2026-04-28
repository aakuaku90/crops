"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  getClimateRegions,
  getClimateMonthly,
  getClimateAnnual,
  getClimateSummary,
  syncClimate,
  type ClimateMonthlyRow,
  type ClimateAnnualRow,
  type ClimateSummary,
} from "@/lib/api";

type Cadence = "monthly" | "annual";

// Initial slice size and how many more rows to reveal on each scroll trigger.
const INITIAL_BATCH = 50;
const SCROLL_BATCH = 50;

// Columns labeled exactly as they appear in X_monthly_regionadj.csv /
// X_annual_regionadj.csv. Keys are the snake_case DB column names defined in
// backend/app/services/climate_service.py (COLUMN_MAP).
const FEATURE_COLUMNS: { key: string; label: string }[] = [
  { key: "t2m", label: "T2M" },
  { key: "t2m_max", label: "T2M_MAX" },
  { key: "t2m_min", label: "T2M_MIN" },
  { key: "t2m_dew", label: "T2MDEW" },
  { key: "t2m_wet", label: "T2MWET" },
  { key: "rh2m", label: "RH2M" },
  { key: "allsky_sw_dwn", label: "ALLSKY_SFC_SW_DWN" },
  { key: "clrsky_sw_dwn", label: "CLRSKY_SFC_SW_DWN" },
  { key: "allsky_par_tot", label: "ALLSKY_SFC_PAR_TOT" },
  { key: "ws2m", label: "WS2M" },
  { key: "ws2m_max", label: "WS2M_MAX" },
  { key: "ws2m_min", label: "WS2M_MIN" },
  { key: "wd2m", label: "WD2M" },
  { key: "ps", label: "PS" },
  { key: "qv2m", label: "QV2M" },
  { key: "gwetroot", label: "GWETROOT" },
  { key: "gwettop", label: "GWETTOP" },
  { key: "gwetprof", label: "GWETPROF" },
  { key: "t2m_range", label: "T2M_RANGE" },
  { key: "prectotcorr", label: "PRECTOTCORR" },
  { key: "total_precip_mm", label: "total_precip_mm" },
  { key: "avg_precip_mm", label: "avg_precip_mm" },
  { key: "rainy_days", label: "rainy_days" },
  { key: "ndvi", label: "1 km monthly NDVI" },
  { key: "evi", label: "1 km monthly EVI" },
  { key: "vi_quality", label: "1 km monthly VI Quality" },
  { key: "red_reflectance", label: "1 km monthly red reflectance" },
  { key: "nir_reflectance", label: "1 km monthly NIR reflectance" },
  { key: "blue_reflectance", label: "1 km monthly blue reflectance" },
  { key: "mir_reflectance", label: "1 km monthly MIR reflectance" },
];

function fmt(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(2);
  return String(v);
}

export default function ClimatePage() {
  const [regions, setRegions] = useState<string[]>([]);
  const [region, setRegion] = useState<string>("Ashanti");
  const [cadence, setCadence] = useState<Cadence>("monthly");
  const [rows, setRows] = useState<(ClimateMonthlyRow | ClimateAnnualRow)[]>([]);
  const [summary, setSummary] = useState<ClimateSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [visible, setVisible] = useState(INITIAL_BATCH);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  async function refresh() {
    const [s, r] = await Promise.all([getClimateSummary(), getClimateRegions()]);
    setSummary(s);
    setRegions(r);
    if (r.length > 0 && !r.includes(region)) setRegion(r[0]);
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (!region) return;
    setLoading(true);
    setVisible(INITIAL_BATCH);
    // Clear rows immediately so stale data from the other cadence isn't
    // rendered with the new key logic (would collide on year alone).
    setRows([]);
    const fetcher =
      cadence === "monthly"
        ? getClimateMonthly({ region, limit: 5000 })
        : getClimateAnnual({ region, limit: 5000 });
    fetcher
      .then((res) => setRows(res.data))
      .finally(() => setLoading(false));
  }, [region, cadence]);

  async function handleSync() {
    setSyncing(true);
    setSyncMsg(null);
    const res = await syncClimate((e) => {
      setSyncMsg(e.message ?? `${e.stage} ${e.pct}%`);
    });
    setSyncMsg(res.message);
    setSyncing(false);
    refresh();
  }

  const sorted = useMemo(
    () =>
      [...rows].sort((a, b) => {
        if (a.year !== b.year) return (b.year as number) - (a.year as number);
        // Annual rows have no `month` — fall back to 0 so sort is stable.
        const am = (a as ClimateMonthlyRow).month ?? 0;
        const bm = (b as ClimateMonthlyRow).month ?? 0;
        return bm - am;
      }),
    [rows],
  );
  const pageRows = sorted.slice(0, visible);
  const hasMore = visible < sorted.length;

  // Reveal more rows when the sentinel scrolls into view. rootMargin nudges
  // the trigger ~200px before the sentinel hits the viewport so scrolling
  // feels continuous rather than staggered.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisible((v) => Math.min(sorted.length, v + SCROLL_BATCH));
        }
      },
      { rootMargin: "200px" },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [hasMore, sorted.length]);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page header */}
      <div className="flex items-end justify-between gap-4 flex-wrap pb-4 border-b border-border">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            Dataset
          </div>
          <h1 className="text-2xl font-bold text-foreground leading-tight">
            Climate (NASA / MODIS)
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            Monthly NASA POWER + MODIS predictors per Ghana region (temperature, precipitation,
            humidity, soil moisture, solar radiation, NDVI, EVI). Charts and trend analysis live
            under <span className="font-semibold text-foreground">Analysis → Climate Trends</span>.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <SearchableSelect
            options={regions.map((r) => ({ value: r, label: r }))}
            value={region}
            onValueChange={setRegion}
            placeholder="Select region"
            className="w-48"
          />
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-2 bg-foreground text-background px-4 py-2 rounded-full text-sm font-medium hover:bg-foreground/90 disabled:opacity-70 disabled:cursor-not-allowed transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing..." : "Sync climate data"}
          </button>
        </div>
      </div>

      {syncMsg && <div className="text-xs text-muted-foreground">{syncMsg}</div>}

      {/* Summary tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <SummaryTile
          label="Monthly rows"
          value={summary?.monthly.rows ?? 0}
          range={
            summary?.monthly.year_min && summary?.monthly.year_max
              ? `${summary.monthly.year_min}–${summary.monthly.year_max}`
              : "—"
          }
        />
        <SummaryTile
          label="Annual rows (z-scored)"
          value={summary?.annual.rows ?? 0}
          range={
            summary?.annual.year_min && summary?.annual.year_max
              ? `${summary.annual.year_min}–${summary.annual.year_max}`
              : "—"
          }
        />
        <SummaryTile label="Regions" value={regions.length} range="Ghana sub-national" />
      </div>

      {/* Region filter */}
      {/* Cadence toggle: monthly raw values vs. annual standardized z-scores */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center rounded-full border border-border p-1 text-xs font-medium">
          {(["monthly", "annual"] as Cadence[]).map((c) => (
            <button
              key={c}
              onClick={() => setCadence(c)}
              className={`rounded-full px-4 py-1 transition-colors capitalize ${
                cadence === c
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
        {cadence === "annual" && (
          <span className="text-[11px] text-muted-foreground">
            Z-scores · model input
          </span>
        )}
      </div>

      {/* Raw data table */}
      <Card className="p-0 overflow-hidden">
        {summary?.monthly.rows === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No data. Click <span className="font-semibold">Sync climate data</span> to ingest.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="text-left font-semibold tracking-wider px-3 py-2 whitespace-nowrap">Year</th>
                  {cadence === "monthly" && (
                    <th className="text-left font-semibold tracking-wider px-3 py-2 whitespace-nowrap">Month</th>
                  )}
                  {FEATURE_COLUMNS.map((c) => (
                    <th key={c.key} className="text-left font-semibold tracking-wider px-3 py-2 whitespace-nowrap">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r, idx) => {
                  const month = (r as ClimateMonthlyRow).month;
                  // Include cadence + idx as belt-and-suspenders against
                  // collisions during state transitions.
                  const key = `${cadence}-${r.year}-${month ?? "y"}-${idx}`;
                  return (
                    <tr key={key} className="border-t border-border hover:bg-muted/30">
                      <td className="px-3 py-1.5 tabular-nums whitespace-nowrap">{r.year}</td>
                      {cadence === "monthly" && (
                        <td className="px-3 py-1.5 tabular-nums whitespace-nowrap">{month}</td>
                      )}
                      {FEATURE_COLUMNS.map((c) => (
                        <td key={c.key} className="px-3 py-1.5 tabular-nums whitespace-nowrap">
                          {fmt((r as Record<string, unknown>)[c.key])}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Infinite-scroll sentinel: when this scrolls into view, more rows reveal. */}
      {hasMore && (
        <div ref={sentinelRef} className="flex items-center justify-center py-4 text-xs text-muted-foreground">
          Loading more…
        </div>
      )}
      {!hasMore && sorted.length > INITIAL_BATCH && (
        <div className="text-center py-4 text-xs text-muted-foreground">
          End of {sorted.length} rows.
        </div>
      )}
    </div>
  );
}

function SummaryTile({ label, value, range }: { label: string; value: number; range: string }) {
  return (
    <Card className="p-4">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        {label}
      </div>
      <div className="text-2xl font-bold tabular-nums text-foreground">
        {value.toLocaleString()}
      </div>
      <div className="text-[11px] text-muted-foreground mt-1">{range}</div>
    </Card>
  );
}
