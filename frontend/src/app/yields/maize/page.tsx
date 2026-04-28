"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  getMofaRegionalRegions,
  getMofaRegionalMaize,
  syncMofaRegionalMaize,
  type MofaRegionalMaizeRow,
} from "@/lib/api";

const INITIAL_BATCH = 50;
const SCROLL_BATCH = 50;

function fmt(v: number | null | undefined, digits = 2): string {
  if (v == null) return "—";
  return v.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export default function MaizeYieldsPage() {
  const [regions, setRegions] = useState<string[]>([]);
  const [region, setRegion] = useState<string>("All regions");
  const [allRows, setAllRows] = useState<MofaRegionalMaizeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [visible, setVisible] = useState(INITIAL_BATCH);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  async function refresh() {
    setLoading(true);
    const [r, all] = await Promise.all([
      getMofaRegionalRegions(),
      getMofaRegionalMaize({ limit: 5000 }),
    ]);
    setRegions(r);
    setAllRows(all.data);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleSync() {
    setSyncing(true);
    setSyncMsg(null);
    const res = await syncMofaRegionalMaize((e) => {
      setSyncMsg(e.message ?? `${e.stage} ${e.pct}%`);
    });
    setSyncMsg(res.message);
    setSyncing(false);
    refresh();
  }

  const filtered = useMemo(() => {
    const r = region === "All regions" ? allRows : allRows.filter((x) => x.region === region);
    return [...r].sort((a, b) =>
      a.year !== b.year ? b.year - a.year : a.region.localeCompare(b.region),
    );
  }, [allRows, region]);

  useEffect(() => {
    setVisible(INITIAL_BATCH);
  }, [region]);

  const pageRows = filtered.slice(0, visible);
  const hasMore = visible < filtered.length;

  // IntersectionObserver: reveal more rows as the sentinel approaches the viewport.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisible((v) => Math.min(filtered.length, v + SCROLL_BATCH));
        }
      },
      { rootMargin: "200px" },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [hasMore, filtered.length]);

  const latestYear = allRows.length ? Math.max(...allRows.map((r) => r.year)) : null;
  const totalProductionLatest = allRows
    .filter((r) => r.year === latestYear)
    .reduce((s, r) => s + (r.total_production_mt ?? 0), 0);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page header */}
      <div className="flex items-end justify-between gap-4 flex-wrap pb-4 border-b border-border">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            Dataset
          </div>
          <h1 className="text-2xl font-bold text-foreground leading-tight">
            MOFA Maize Regional
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            MOFA regional maize statistics: total area (ha), average yield (mt/ha), and total
            production (mt) per Ghana region, 1999 to 2023. Charts and trend analysis live under
            <span className="font-semibold text-foreground"> Analysis → Maize Trends</span>.
          </p>
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
            {syncing ? "Syncing..." : "Sync MOFA maize data"}
          </button>
        </div>
      </div>

      {syncMsg && <div className="text-xs text-muted-foreground">{syncMsg}</div>}

      {/* Summary tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <SummaryTile label="Records" value={allRows.length.toLocaleString()} sub="region × year rows" />
        <SummaryTile
          label="Latest year"
          value={String(latestYear ?? "—")}
          sub={
            latestYear
              ? `${allRows.filter((r) => r.year === latestYear).length} regions reporting`
              : "—"
          }
        />
        <SummaryTile
          label={`Total production (${latestYear ?? "—"})`}
          value={`${fmt(totalProductionLatest, 0)} mt`}
          sub="nationwide"
        />
      </div>

      {/* Raw data table */}
      <Card className="p-0 overflow-hidden">
        {allRows.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No data. Click <span className="font-semibold">Sync MOFA maize data</span> to ingest.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="text-left font-semibold uppercase tracking-wider px-3 py-2 whitespace-nowrap">Year</th>
                  <th className="text-left font-semibold uppercase tracking-wider px-3 py-2 whitespace-nowrap">Region</th>
                  <th className="text-right font-semibold uppercase tracking-wider px-3 py-2 whitespace-nowrap">Area (ha)</th>
                  <th className="text-right font-semibold uppercase tracking-wider px-3 py-2 whitespace-nowrap">Yield (mt/ha)</th>
                  <th className="text-right font-semibold uppercase tracking-wider px-3 py-2 whitespace-nowrap">Production (mt)</th>
                  <th className="text-left font-semibold uppercase tracking-wider px-3 py-2 whitespace-nowrap">Source</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => (
                  <tr key={`${r.year}-${r.region}`} className="border-t border-border hover:bg-muted/30">
                    <td className="px-3 py-1.5 tabular-nums">{r.year}</td>
                    <td className="px-3 py-1.5">{r.region}</td>
                    <td className="px-3 py-1.5 tabular-nums text-right">{fmt(r.total_area_ha, 0)}</td>
                    <td className="px-3 py-1.5 tabular-nums text-right">{fmt(r.avg_yield_mt_ha)}</td>
                    <td className="px-3 py-1.5 tabular-nums text-right">{fmt(r.total_production_mt, 0)}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{r.source}</td>
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
      {!hasMore && filtered.length > INITIAL_BATCH && (
        <div className="text-center py-4 text-xs text-muted-foreground">
          End of {filtered.length} rows.
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
      <div className="text-2xl font-bold tabular-nums text-foreground">{value}</div>
      <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>
    </Card>
  );
}
