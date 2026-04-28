"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  GssCropProduction,
  GssSyncProgress,
  getGssCropProduction,
  getGssRegions,
  getGssDistricts,
  getGssCrops,
  uploadGssCsv,
  syncGssFromMofa,
} from "@/lib/api";
import { CHART_COLORS, CHART_GRID_STROKE } from "@/lib/design-tokens";

function formatYAxis(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(value);
}

const COLORS = CHART_COLORS;
const ELEMENTS = ["Area", "Production", "Yield"];

export default function GssPage() {
  const [records, setRecords] = useState<GssCropProduction[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const [regions, setRegions] = useState<string[]>([]);
  const [districts, setDistricts] = useState<string[]>([]);
  const [crops, setCrops] = useState<string[]>([]);

  const [selectedRegion, setSelectedRegion] = useState("");
  const [selectedDistrict, setSelectedDistrict] = useState("");
  const [selectedCrop, setSelectedCrop] = useState("");
  const [selectedElement, setSelectedElement] = useState("Production");
  const [selectedYear, setSelectedYear] = useState("");

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "uploading" | "success" | "error">("idle");
  const [uploadMsg, setUploadMsg] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncPct, setSyncPct] = useState(0);
  const [syncStage, setSyncStage] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchMore = useCallback(async (currentOffset: number, reset = false) => {
    setLoading(true);
    const result = await getGssCropProduction({
      region: selectedRegion || undefined,
      district: selectedDistrict || undefined,
      crop: selectedCrop || undefined,
      element: selectedElement || undefined,
      year: selectedYear ? Number(selectedYear) : undefined,
      limit: 100,
      offset: currentOffset,
    });
    setRecords(prev => reset ? result.data : [...prev, ...result.data]);
    setTotal(result.total);
    setOffset(currentOffset + result.data.length);
    setHasMore(currentOffset + result.data.length < result.total);
    setLoading(false);
  }, [selectedRegion, selectedDistrict, selectedCrop, selectedElement, selectedYear]);

  const loadMeta = useCallback(async () => {
    const [r, c] = await Promise.all([getGssRegions(), getGssCrops()]);
    setRegions(r);
    setCrops(c);
  }, []);

  // When region changes, reload districts and clear district selection
  useEffect(() => {
    setSelectedDistrict("");
    getGssDistricts(selectedRegion || undefined).then(setDistricts);
  }, [selectedRegion]);

  useEffect(() => {
    loadMeta();
    fetchMore(0, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setRecords([]); setOffset(0); setHasMore(true);
    fetchMore(0, true);
  }, [selectedRegion, selectedDistrict, selectedCrop, selectedElement, selectedYear, fetchMore]);

  useEffect(() => {
    if (!hasMore || loading) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) fetchMore(offset); },
      { threshold: 0.1 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loading, offset, fetchMore]);

  const STAGE_LABELS: Record<string, string> = {
    downloading: "Downloading…",
    parsing: "Reading file…",
    loading: "Loading records…",
    upserting: "Saving to database…",
    done: "Done",
    error: "Error",
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncPct(0);
    setSyncStage("Connecting…");
    setUploadStatus("idle");
    setUploadMsg("");

    const result = await syncGssFromMofa((event: GssSyncProgress) => {
      setSyncPct(event.pct);
      setSyncStage(STAGE_LABELS[event.stage] ?? event.stage);
    });

    if (result.status === "success") {
      setUploadStatus("success");
      setUploadMsg(result.message);
      await loadMeta();
      getGssDistricts(selectedRegion || undefined).then(setDistricts);
      setRecords([]); setOffset(0); setHasMore(true);
      await fetchMore(0, true);
    } else {
      setUploadStatus("error");
      setUploadMsg(result.message ?? "Sync failed");
    }
    setSyncing(false);
  };

  const handleFile = async (file: File) => {
    setSyncing(true);
    setSyncPct(0);
    setSyncStage("Parsing CSV…");
    setUploadStatus("idle");
    setUploadMsg("");

    const result = await uploadGssCsv(file, (event: GssSyncProgress) => {
      setSyncPct(event.pct);
      setSyncStage(STAGE_LABELS[event.stage] ?? event.stage);
    });

    if (result.status === "success") {
      setUploadStatus("success");
      setUploadMsg(result.message);
      await loadMeta();
      getGssDistricts(selectedRegion || undefined).then(setDistricts);
      setRecords([]); setOffset(0); setHasMore(true);
      await fetchMore(0, true);
      setTimeout(() => setUploadOpen(false), 1500);
    } else {
      setUploadStatus("error");
      setUploadMsg(result.message ?? "Upload failed");
    }
    setSyncing(false);
  };

  // Chart: values by region (or district if region selected), series per crop
  const chartData = (() => {
    const groupKey = selectedRegion ? "district" : "region";
    const visibleCrops = selectedCrop ? [selectedCrop] : [...new Set(records.map(r => r.crop))].slice(0, 5);
    const byGroup: Record<string, Record<string, number>> = {};
    for (const r of records) {
      if (!visibleCrops.includes(r.crop)) continue;
      const key = r[groupKey] || r.region;
      if (!byGroup[key]) byGroup[key] = {};
      byGroup[key][r.crop] = r.value ?? 0;
    }
    return Object.entries(byGroup).sort(([a], [b]) => a.localeCompare(b)).map(([label, vals]) => ({ label, ...vals }));
  })();

  const chartCrops = [...new Set(chartData.flatMap(d => Object.keys(d).filter(k => k !== "label")))];

  const regionOptions = [{ value: "", label: "All regions" }, ...regions.filter(r => r).map(r => ({ value: r, label: r }))];
  const districtOptions = [{ value: "", label: "All districts" }, ...districts.filter(d => d).map(d => ({ value: d, label: d }))];
  const cropOptions = [{ value: "", label: "All crops" }, ...crops.filter(c => c).map(c => ({ value: c, label: c }))];
  const elementOptions = [{ value: "", label: "All elements" }, ...ELEMENTS.map(e => ({ value: e, label: e }))];
  const years = [...new Set(records.map(r => String(r.year)))].sort((a, b) => Number(b) - Number(a));
  const yearOptions = [{ value: "", label: "All years" }, ...years.map(y => ({ value: y, label: y }))];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="space-y-4 pb-4 border-b border-border">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              Dataset
            </div>
            <h1 className="text-2xl font-bold text-foreground leading-tight">
              GSS Sub-national Data
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Sub-national crop production estimates by region and district, sourced from the Ghana Statistical Service.
            </p>
          </div>
          <div className="flex items-center rounded-full border border-border p-1 text-sm font-medium">
            <button
              onClick={() => { setUploadOpen(true); setUploadStatus("idle"); setUploadMsg(""); }}
              className="rounded-full px-4 py-1 text-muted-foreground hover:text-foreground transition-colors"
            >
              Upload CSV
            </button>
            <button
              onClick={handleSync}
              disabled={syncing}
              className="rounded-full px-4 py-1 bg-foreground text-background hover:bg-foreground/90 disabled:opacity-60 transition-colors inline-flex items-center gap-2"
            >
              {syncing ? (
                <><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-background border-t-transparent" />Syncing…</>
              ) : (
                "Sync from MoFA"
              )}
            </button>
          </div>
        </div>
        {syncing && !uploadOpen && (
          <div>
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>{syncStage}</span>
              <span>{syncPct}%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-foreground transition-all duration-300"
                style={{ width: `${syncPct}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Upload modal */}
      {uploadOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setUploadOpen(false)} />
          <div className="relative w-full max-w-lg rounded-2xl bg-card border border-border shadow-xl">
            <div className="flex items-center justify-between px-6 pt-5 pb-3">
              <div>
                <h3 className="text-base font-semibold text-foreground">Upload CSV Data</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Required columns:{" "}
                  <code className="bg-muted px-1 rounded text-foreground">
                    YEAR, REGION, DISTRICT, COMMODITY, AREA_CROPPED_Ha, AVERAGE_YIELD_Mt_per_Ha, PRODUCTION_Mt
                  </code>
                </p>
              </div>
              <button onClick={() => setUploadOpen(false)} className="ml-4 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-6 pb-6">
              <div
                className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border bg-muted px-6 py-10 text-center transition-colors hover:border-foreground hover:bg-muted/70 cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files[0];
                  if (file) { handleFile(file); }
                }}
              >
                <svg className="h-8 w-8 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
                <p className="text-sm text-foreground">
                  {syncing ? "Uploading…" : "Click or drag a CSV file here"}
                </p>
                {uploadStatus === "success" && <p className="text-xs text-foreground font-medium">{uploadMsg}</p>}
                {uploadStatus === "error" && <p className="text-xs text-destructive font-medium">{uploadMsg}</p>}
              </div>
              {syncing && (
                <div className="mt-3">
                  <div className="flex justify-between text-xs text-muted-foreground mb-1">
                    <span>{syncStage}</span>
                    <span>{syncPct}%</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-foreground transition-all duration-300" style={{ width: `${syncPct}%` }} />
                  </div>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <SearchableSelect options={regionOptions} value={selectedRegion} onValueChange={setSelectedRegion} placeholder="All regions" className="w-48" />
        <SearchableSelect options={districtOptions} value={selectedDistrict} onValueChange={setSelectedDistrict} placeholder="All districts" className="w-48" />
        <SearchableSelect options={cropOptions} value={selectedCrop} onValueChange={setSelectedCrop} placeholder="All crops" className="w-48" />
        <SearchableSelect options={elementOptions} value={selectedElement} onValueChange={setSelectedElement} placeholder="All elements" className="w-40" />
        <SearchableSelect options={yearOptions} value={selectedYear} onValueChange={setSelectedYear} placeholder="All years" className="w-32" />
      </div>
      <p className="text-sm text-muted-foreground">{total.toLocaleString()} records</p>

      {/* Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {selectedCrop || "Crop Production"}{selectedElement ? `: ${selectedElement}` : ""}{selectedYear ? ` (${selectedYear})` : ""}
          </CardTitle>
          <CardDescription>
            By {selectedRegion ? "district" : "region"}{selectedCrop ? "" : " · top 5 crops shown"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading && chartData.length === 0 ? (
            <Skeleton className="h-72 w-full" />
          ) : chartData.length === 0 ? (
            <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
              No data. Upload a CSV to get started.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={chartData} margin={{ top: 8, right: 24, left: -20, bottom: 50 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} angle={-35} textAnchor="end" interval={0} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={formatYAxis} />
                <Tooltip contentStyle={{ fontSize: 12 }} formatter={(value: number, name: string) => [Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 }), name]} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {chartCrops.map((crop, i) => (
                  <Bar key={crop} dataKey={crop} name={crop} fill={COLORS[i % COLORS.length]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Regional Crop Records</CardTitle>
          <CardDescription>{records.length.toLocaleString()} of {total.toLocaleString()} records</CardDescription>
        </CardHeader>
        <CardContent>
          {loading && records.length === 0 ? (
            <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
          ) : records.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No data. Upload a CSV to get started.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm whitespace-nowrap">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="pb-2 pr-4 font-medium text-muted-foreground">Year</th>
                      <th className="pb-2 pr-4 font-medium text-muted-foreground">Region</th>
                      <th className="pb-2 pr-4 font-medium text-muted-foreground">District</th>
                      <th className="pb-2 pr-4 font-medium text-muted-foreground">Crop</th>
                      <th className="pb-2 pr-4 font-medium text-muted-foreground">Element</th>
                      <th className="pb-2 pr-4 font-medium text-muted-foreground">Unit</th>
                      <th className="pb-2 pr-4 font-medium text-muted-foreground text-right">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((r) => (
                      <tr key={r.id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                        <td className="py-2 pr-4 text-xs text-muted-foreground">{r.year}</td>
                        <td className="py-2 pr-4">{r.region}</td>
                        <td className="py-2 pr-4 text-xs text-muted-foreground">{r.district || "—"}</td>
                        <td className="py-2 pr-4 font-medium">{r.crop}</td>
                        <td className="py-2 pr-4 text-xs text-muted-foreground">{r.element}</td>
                        <td className="py-2 pr-4 text-xs text-muted-foreground">{r.unit || "—"}</td>
                        <td className="py-2 pr-4 text-right font-mono font-semibold">
                          {r.value == null ? "—" : Number(r.value).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {hasMore ? (
                <><div ref={sentinelRef} className="h-4" />{loading && <p className="py-2 text-center text-xs text-muted-foreground">Loading…</p>}</>
              ) : (
                <p className="pt-4 text-center text-xs text-muted-foreground">All {total.toLocaleString()} records loaded</p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
