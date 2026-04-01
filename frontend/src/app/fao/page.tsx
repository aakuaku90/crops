"use client";

import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  FaoCpiRecord,
  FaoProducerPrice,
  FaoFoodSecurity,
  FaoCropProduction,
  FaoExchangeRate,
  FaoHealthyDietCost,
  FaoValueProduction,
  FaoFoodBalance,
  getFaoCpi,
  getFaoProducerPrices,
  getFaoItems,
  getFaoFoodSecurity,
  getFaoFoodSecurityItems,
  getFaoCropProduction,
  getFaoCropProductionItems,
  getFaoExchangeRates,
  getFaoHealthyDietCost,
  getFaoValueProduction,
  getFaoValueProductionItems,
  getFaoFoodBalances,
  getFaoFoodBalanceItems,
  triggerFaoCpiSync,
  triggerFaoProducerSync,
  triggerFaoFoodSecuritySync,
  triggerFaoCropProductionSync,
  triggerFaoExchangeRatesSync,
  triggerFaoHealthyDietSync,
  triggerFaoValueProductionSync,
  triggerFaoFoodBalancesSync,
  FaoSupplyUtilization,
  getFaoSupplyUtilization,
  getFaoSupplyUtilizationItems,
  triggerFaoSupplyUtilizationSync,
} from "@/lib/api";

// ── Colour palette for the three CPI series ──────────────────────────────────
const CPI_SERIES = [
  {
    key: "Consumer Prices, Food Indices (2015=100)",
    label: "Food Index",
    color: "#16a34a",
  },
  {
    key: "Consumer Prices, General Indices (2015=100)",
    label: "General Index",
    color: "#2563eb",
  },
  {
    key: "Food price inflation",
    label: "Food Inflation (%)",
    color: "#dc2626",
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatYAxis(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(value);
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

function buildCpiChartData(records: FaoCpiRecord[]) {
  const byDate: Record<string, Record<string, number>> = {};

  for (const r of records) {
    if (!byDate[r.start_date]) byDate[r.start_date] = {};
    if (r.value != null) byDate[r.start_date][r.item] = r.value;
  }

  return Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, values]) => ({
      date,
      label: formatDate(date),
      ...values,
    }));
}

function buildProducerChartData(records: FaoProducerPrice[]) {
  return records
    .filter((r) => r.value != null)
    .sort((a, b) => a.start_date.localeCompare(b.start_date))
    .map((r) => ({
      date: r.start_date,
      label: r.year ? String(r.year) : formatDate(r.start_date),
      value: r.value,
    }));
}

// ── Sync button component ─────────────────────────────────────────────────────

function SyncBtn({
  label,
  onSync,
}: {
  label: string;
  onSync: () => Promise<{ status: string; records_inserted: number; message: string }>;
}) {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const handleClick = async () => {
    setLoading(true);
    setMsg(null);
    try {
      const result = await onSync();
      setMsg(result.message);
    } catch {
      setMsg("Sync failed — check console");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={handleClick}
        disabled={loading}
        className="inline-flex items-center gap-2 rounded-full bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800 disabled:opacity-60 transition-colors"
      >
        {loading ? (
          <>
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
            Syncing…
          </>
        ) : (
          label
        )}
      </button>
      {msg && <p className="text-xs text-gray-500">{msg}</p>}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

type Tab = "cpi" | "producer" | "food-security" | "crop-production" | "exchange-rates" | "diet-cost" | "value-production" | "food-balances" | "supply-utilization";

const TAB_LABELS: Record<Tab, string> = {
  "cpi": "Consumer Price Indices",
  "producer": "Producer Prices",
  "food-security": "Food Security",
  "crop-production": "Crop Production",
  "exchange-rates": "Exchange Rates",
  "diet-cost": "Healthy Diet Cost",
  "value-production": "Value of Production",
  "food-balances": "Food Balances",
  "supply-utilization": "Supply Utilization",
};

const CROP_ELEMENTS = ["Area harvested", "Production", "Yield"];

const VALID_TABS = new Set<Tab>(["cpi", "producer", "food-security", "crop-production", "exchange-rates", "diet-cost", "value-production", "food-balances", "supply-utilization"]);

function FaoPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get("tab") ?? "cpi") as Tab;
  const [tab, setTab] = useState<Tab>(VALID_TABS.has(initialTab) ? initialTab : "cpi");
  const loadedTabs = useRef<Set<Tab>>(new Set([VALID_TABS.has(initialTab) ? initialTab : "cpi"]));

  // ── CPI state ──
  const [cpiRecords, setCpiRecords] = useState<FaoCpiRecord[]>([]);
  const [loadingCpi, setLoadingCpi] = useState(true);

  // ── Producer Prices state ──
  const [producerPrices, setProducerPrices] = useState<FaoProducerPrice[]>([]);
  const [items, setItems] = useState<string[]>([]);
  const [selectedItem, setSelectedItem] = useState<string>("");
  const [loadingProducer, setLoadingProducer] = useState(true);

  // ── Food Security state ──
  const [fsRecords, setFsRecords] = useState<FaoFoodSecurity[]>([]);
  const [fsItems, setFsItems] = useState<string[]>([]);
  const [fsSelectedItem, setFsSelectedItem] = useState<string>("");
  const [loadingFs, setLoadingFs] = useState(false);

  // ── Crop Production state ──
  const [cropRecords, setCropRecords] = useState<FaoCropProduction[]>([]);
  const [cropTotal, setCropTotal] = useState(0);
  const [cropOffset, setCropOffset] = useState(0);
  const [cropHasMore, setCropHasMore] = useState(true);
  const cropSentinelRef = useRef<HTMLDivElement>(null);
  const [cropItems, setCropItems] = useState<string[]>([]);
  const [cropSelectedItem, setCropSelectedItem] = useState<string>("");
  const [cropSelectedElement, setCropSelectedElement] = useState<string>("");
  const [loadingCrop, setLoadingCrop] = useState(false);

  // ── Exchange Rates state ──
  const [exRecords, setExRecords] = useState<FaoExchangeRate[]>([]);
  const [loadingEx, setLoadingEx] = useState(false);

  // ── Healthy Diet Cost state ──
  const [dietRecords, setDietRecords] = useState<FaoHealthyDietCost[]>([]);
  const [loadingDiet, setLoadingDiet] = useState(false);

  // ── Value of Production state ──
  const [valueRecords, setValueRecords] = useState<FaoValueProduction[]>([]);
  const [valueTotal, setValueTotal] = useState(0);
  const [valueOffset, setValueOffset] = useState(0);
  const [valueHasMore, setValueHasMore] = useState(true);
  const valueSentinelRef = useRef<HTMLDivElement>(null);
  const [valueItems, setValueItems] = useState<string[]>([]);
  const [valueSelectedItem, setValueSelectedItem] = useState<string>("");
  const [valueSelectedElement, setValueSelectedElement] = useState<string>("");
  const [loadingValue, setLoadingValue] = useState(false);

  // ── Food Balances state ──
  const [foodBalRecords, setFoodBalRecords] = useState<FaoFoodBalance[]>([]);
  const [foodBalTotal, setFoodBalTotal] = useState(0);
  const [foodBalOffset, setFoodBalOffset] = useState(0);
  const [foodBalHasMore, setFoodBalHasMore] = useState(true);
  const foodBalSentinelRef = useRef<HTMLDivElement>(null);
  const [foodBalItems, setFoodBalItems] = useState<string[]>([]);
  const [foodBalSelectedItem, setFoodBalSelectedItem] = useState<string>("");
  const [foodBalSelectedElement, setFoodBalSelectedElement] = useState<string>("");
  const [loadingFoodBal, setLoadingFoodBal] = useState(false);

  // ── Supply Utilization state ──
  const [sclRecords, setSclRecords] = useState<FaoSupplyUtilization[]>([]);
  const [sclTotal, setSclTotal] = useState(0);
  const [sclOffset, setSclOffset] = useState(0);
  const [sclHasMore, setSclHasMore] = useState(true);
  const sclSentinelRef = useRef<HTMLDivElement>(null);
  const [sclItems, setSclItems] = useState<string[]>([]);
  const [sclSelectedItem, setSclSelectedItem] = useState<string>("");
  const [sclSelectedElement, setSclSelectedElement] = useState<string>("");
  const [loadingScl, setLoadingScl] = useState(false);
  const [sclSidebarRecord, setSclSidebarRecord] = useState<FaoSupplyUtilization | null>(null);

  // ── Load CPI ──
  const loadCpi = useCallback(async () => {
    setLoadingCpi(true);
    const data = await getFaoCpi();
    setCpiRecords(data);
    setLoadingCpi(false);
  }, []);

  // ── Load Producer Prices ──
  const loadItems = useCallback(async () => {
    const data = await getFaoItems();
    setItems(data);
    if (data.length > 0) setSelectedItem(data[0]);
  }, []);

  const loadProducerPrices = useCallback(async (item: string) => {
    if (!item) return;
    setLoadingProducer(true);
    const data = await getFaoProducerPrices(item);
    setProducerPrices(data);
    setLoadingProducer(false);
  }, []);

  // ── Load Food Security ──
  const loadFoodSecurity = useCallback(async (item?: string) => {
    setLoadingFs(true);
    const data = await getFaoFoodSecurity(item);
    setFsRecords(data);
    setLoadingFs(false);
  }, []);

  const loadFsItems = useCallback(async () => {
    const data = await getFaoFoodSecurityItems();
    setFsItems(data);
    if (data.length > 0) setFsSelectedItem(data[0]);
  }, []);

  // ── Load Crop Production (infinite scroll) ──
  const fetchMoreCrop = useCallback(async (currentOffset: number, reset = false) => {
    setLoadingCrop(true);
    const result = await getFaoCropProduction(cropSelectedItem || undefined, cropSelectedElement || undefined, 100, currentOffset);
    setCropRecords(prev => reset ? result.data : [...prev, ...result.data]);
    setCropTotal(result.total);
    setCropOffset(currentOffset + result.data.length);
    setCropHasMore(currentOffset + result.data.length < result.total);
    setLoadingCrop(false);
  }, [cropSelectedItem, cropSelectedElement]);

  const loadCropItems = useCallback(async () => {
    const data = await getFaoCropProductionItems();
    setCropItems(data);
    if (data.length > 0) setCropSelectedItem(data[0]);
  }, []);

  // ── Load Exchange Rates ──
  const loadExchangeRates = useCallback(async () => {
    setLoadingEx(true);
    const data = await getFaoExchangeRates();
    setExRecords(data);
    setLoadingEx(false);
  }, []);

  // ── Load Healthy Diet Cost ──
  const loadDietCost = useCallback(async () => {
    setLoadingDiet(true);
    const data = await getFaoHealthyDietCost();
    setDietRecords(data);
    setLoadingDiet(false);
  }, []);

  // ── Load Value of Production (infinite scroll) ──
  const fetchMoreValue = useCallback(async (currentOffset: number, reset = false) => {
    setLoadingValue(true);
    const result = await getFaoValueProduction(valueSelectedItem || undefined, valueSelectedElement || undefined, 100, currentOffset);
    setValueRecords(prev => reset ? result.data : [...prev, ...result.data]);
    setValueTotal(result.total);
    setValueOffset(currentOffset + result.data.length);
    setValueHasMore(currentOffset + result.data.length < result.total);
    setLoadingValue(false);
  }, [valueSelectedItem, valueSelectedElement]);

  const loadValueItems = useCallback(async () => {
    const data = await getFaoValueProductionItems();
    setValueItems(data);
    if (data.length > 0) setValueSelectedItem(data[0]);
  }, []);

  // ── Load Food Balances (infinite scroll) ──
  const fetchMoreFoodBal = useCallback(async (currentOffset: number, reset = false) => {
    setLoadingFoodBal(true);
    const result = await getFaoFoodBalances(foodBalSelectedItem || undefined, foodBalSelectedElement || undefined, 100, currentOffset);
    setFoodBalRecords(prev => reset ? result.data : [...prev, ...result.data]);
    setFoodBalTotal(result.total);
    setFoodBalOffset(currentOffset + result.data.length);
    setFoodBalHasMore(currentOffset + result.data.length < result.total);
    setLoadingFoodBal(false);
  }, [foodBalSelectedItem, foodBalSelectedElement]);

  const loadFoodBalItems = useCallback(async () => {
    const data = await getFaoFoodBalanceItems();
    setFoodBalItems(data);
    if (data.length > 0) setFoodBalSelectedItem(data[0]);
  }, []);

  // ── Load Supply Utilization (infinite scroll) ──
  const fetchMoreScl = useCallback(async (currentOffset: number, reset = false) => {
    setLoadingScl(true);
    const result = await getFaoSupplyUtilization(sclSelectedItem || undefined, sclSelectedElement || undefined, 100, currentOffset);
    setSclRecords(prev => reset ? result.data : [...prev, ...result.data]);
    setSclTotal(result.total);
    setSclOffset(currentOffset + result.data.length);
    setSclHasMore(currentOffset + result.data.length < result.total);
    setLoadingScl(false);
  }, [sclSelectedItem, sclSelectedElement]);

  const loadSclItems = useCallback(async () => {
    const data = await getFaoSupplyUtilizationItems();
    setSclItems(data);
    if (data.length > 0) setSclSelectedItem(data[0]);
  }, []);

  // ── Initial loads ──
  useEffect(() => {
    // CPI + producer always load upfront
    loadCpi();
    loadItems();
    loadedTabs.current.add("cpi");
    loadedTabs.current.add("producer");

    // If the URL restores a non-default tab, trigger its initial data load
    const t = tab;
    if (t === "food-security") {
      loadFsItems().then(() => loadFoodSecurity(undefined));
    } else if (t === "crop-production") {
      loadCropItems();
      fetchMoreCrop(0, true);
    } else if (t === "exchange-rates") {
      loadExchangeRates();
    } else if (t === "diet-cost") {
      loadDietCost();
    } else if (t === "value-production") {
      loadValueItems();
      fetchMoreValue(0, true);
    } else if (t === "food-balances") {
      loadFoodBalItems();
      fetchMoreFoodBal(0, true);
    } else if (t === "supply-utilization") {
      loadSclItems();
      fetchMoreScl(0, true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedItem) loadProducerPrices(selectedItem);
  }, [selectedItem, loadProducerPrices]);

  // ── Food Security: refetch when item changes ──
  useEffect(() => {
    if (loadedTabs.current.has("food-security")) {
      loadFoodSecurity(fsSelectedItem || undefined);
    }
  }, [fsSelectedItem, loadFoodSecurity]);

  // ── Crop Production: reset + refetch when item/element changes ──
  useEffect(() => {
    if (loadedTabs.current.has("crop-production")) {
      setCropRecords([]);
      setCropOffset(0);
      setCropHasMore(true);
      fetchMoreCrop(0, true);
    }
  }, [cropSelectedItem, cropSelectedElement, fetchMoreCrop]);

  // ── Value Production: reset + refetch when item/element changes ──
  useEffect(() => {
    if (loadedTabs.current.has("value-production")) {
      setValueRecords([]);
      setValueOffset(0);
      setValueHasMore(true);
      fetchMoreValue(0, true);
    }
  }, [valueSelectedItem, valueSelectedElement, fetchMoreValue]);

  // ── Food Balances: reset + refetch when item/element changes ──
  useEffect(() => {
    if (loadedTabs.current.has("food-balances")) {
      setFoodBalRecords([]);
      setFoodBalOffset(0);
      setFoodBalHasMore(true);
      fetchMoreFoodBal(0, true);
    }
  }, [foodBalSelectedItem, foodBalSelectedElement, fetchMoreFoodBal]);

  // ── Supply Utilization: reset + refetch when item/element changes ──
  useEffect(() => {
    if (loadedTabs.current.has("supply-utilization")) {
      setSclRecords([]);
      setSclOffset(0);
      setSclHasMore(true);
      fetchMoreScl(0, true);
    }
  }, [sclSelectedItem, sclSelectedElement, fetchMoreScl]);

  // ── Infinite scroll observers ──
  useEffect(() => {
    if (!cropHasMore || loadingCrop) return;
    const sentinel = cropSentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) fetchMoreCrop(cropOffset); },
      { threshold: 0.1 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [cropHasMore, loadingCrop, cropOffset, fetchMoreCrop]);

  useEffect(() => {
    if (!valueHasMore || loadingValue) return;
    const sentinel = valueSentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) fetchMoreValue(valueOffset); },
      { threshold: 0.1 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [valueHasMore, loadingValue, valueOffset, fetchMoreValue]);

  useEffect(() => {
    if (!foodBalHasMore || loadingFoodBal) return;
    const sentinel = foodBalSentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) fetchMoreFoodBal(foodBalOffset); },
      { threshold: 0.1 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [foodBalHasMore, loadingFoodBal, foodBalOffset, fetchMoreFoodBal]);

  useEffect(() => {
    if (!sclHasMore || loadingScl) return;
    const sentinel = sclSentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) fetchMoreScl(sclOffset); },
      { threshold: 0.1 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [sclHasMore, loadingScl, sclOffset, fetchMoreScl]);

  // ── Lazy load on tab switch ──
  const handleTabChange = useCallback((t: Tab) => {
    setTab(t);
    router.replace(`?tab=${t}`, { scroll: false });
    if (loadedTabs.current.has(t)) return;
    loadedTabs.current.add(t);
    if (t === "food-security") {
      loadFsItems().then(() => loadFoodSecurity(undefined));
    } else if (t === "crop-production") {
      loadCropItems();
      fetchMoreCrop(0, true);
    } else if (t === "exchange-rates") {
      loadExchangeRates();
    } else if (t === "diet-cost") {
      loadDietCost();
    } else if (t === "value-production") {
      loadValueItems();
      fetchMoreValue(0, true);
    } else if (t === "food-balances") {
      loadFoodBalItems();
      fetchMoreFoodBal(0, true);
    } else if (t === "supply-utilization") {
      loadSclItems();
      fetchMoreScl(0, true);
    }
  }, [router, loadFsItems, loadFoodSecurity, loadCropItems, fetchMoreCrop, loadExchangeRates, loadDietCost, loadValueItems, fetchMoreValue, loadFoodBalItems, fetchMoreFoodBal, loadSclItems, fetchMoreScl]);

  // ── Chart data ──
  const cpiChartData = buildCpiChartData(cpiRecords);
  const producerChartData = buildProducerChartData(producerPrices);

  // Food Security chart: series per item, x = year_label (cap to 4 series when unfiltered)
  const fsChartData = (() => {
    const visibleItems = fsSelectedItem
      ? [fsSelectedItem]
      : [...new Set(fsRecords.map((r) => r.item))].slice(0, 4);
    const byYear: Record<string, Record<string, number>> = {};
    for (const r of fsRecords) {
      if (!visibleItems.includes(r.item)) continue;
      if (!byYear[r.year_label]) byYear[r.year_label] = {};
      byYear[r.year_label][r.item] = r.value;
    }
    return Object.entries(byYear)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, vals]) => ({ label, ...vals }));
  })();

  // Crop Production chart: by year, for selected item+element
  const cropChartData = (() => {
    const filtered = cropRecords.filter(
      (r) =>
        (!cropSelectedItem || r.item === cropSelectedItem) &&
        (!cropSelectedElement || r.element === cropSelectedElement)
    );
    return filtered
      .sort((a, b) => a.year - b.year)
      .map((r) => ({ label: String(r.year), value: r.value, unit: r.unit }));
  })();

  // Exchange Rates chart: annual GHS/USD
  const exAnnualData = exRecords
    .filter((r) => r.months && r.months.toLowerCase().includes("annual"))
    .sort((a, b) => a.year - b.year)
    .map((r) => ({ label: String(r.year), value: r.value, element: r.element }));

  // Healthy Diet Cost chart: cost per year, bar chart
  const dietChartData = (() => {
    const byYear: Record<number, Record<string, number>> = {};
    for (const r of dietRecords) {
      if (!byYear[r.year]) byYear[r.year] = {};
      byYear[r.year][r.item] = r.value;
    }
    return Object.entries(byYear)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([year, vals]) => ({ label: year, ...vals }));
  })();

  const dietItems = [...new Set(dietRecords.map((r) => r.item))];

  const dietColors = ["#16a34a", "#2563eb", "#dc2626", "#d97706", "#7c3aed", "#0891b2"];

  // Value Production chart: by year for selected item+element
  const valueChartData = (() => {
    const filtered = valueRecords.filter(
      (r) =>
        (!valueSelectedItem || r.item === valueSelectedItem) &&
        (!valueSelectedElement || r.element === valueSelectedElement)
    );
    return filtered
      .sort((a, b) => a.year - b.year)
      .map((r) => ({ label: String(r.year), value: r.value, unit: r.unit }));
  })();

  // Food Balances chart: by year for selected item+element
  const foodBalChartData = (() => {
    const filtered = foodBalRecords.filter(
      (r) =>
        (!foodBalSelectedItem || r.item === foodBalSelectedItem) &&
        (!foodBalSelectedElement || r.element === foodBalSelectedElement)
    );
    return filtered
      .sort((a, b) => a.year - b.year)
      .map((r) => ({ label: String(r.year), value: r.value, unit: r.unit }));
  })();

  const valueElements = [...new Set(valueRecords.map((r) => r.element).filter(Boolean))] as string[];
  const foodBalElements = [...new Set(foodBalRecords.map((r) => r.element).filter(Boolean))] as string[];

  const itemOptions = items.map((i) => ({ value: i, label: i }));
  const fsItemOptions = [{ value: "", label: "All items" }, ...fsItems.map((i) => ({ value: i, label: i }))];
  const cropItemOptions = [{ value: "", label: "All items" }, ...cropItems.map((i) => ({ value: i, label: i }))];
  const cropElementOptions = [{ value: "", label: "All elements" }, ...CROP_ELEMENTS.map((e) => ({ value: e, label: e }))];
  const valueItemOptions = [{ value: "", label: "All items" }, ...valueItems.map((i) => ({ value: i, label: i }))];
  const valueElementOptions = [{ value: "", label: "All elements" }, ...valueElements.map((e) => ({ value: e, label: e }))];
  const foodBalItemOptions = [{ value: "", label: "All items" }, ...foodBalItems.map((i) => ({ value: i, label: i }))];
  const foodBalElementOptions = [{ value: "", label: "All elements" }, ...foodBalElements.map((e) => ({ value: e, label: e }))];

  // Supply Utilization chart: by year for selected item, series per element
  const sclChartData = (() => {
    const filtered = sclRecords.filter(
      (r) =>
        (!sclSelectedItem || r.item === sclSelectedItem) &&
        (!sclSelectedElement || r.element === sclSelectedElement)
    );
    if (sclSelectedElement) {
      return filtered
        .sort((a, b) => a.year - b.year)
        .map((r) => ({ label: String(r.year), value: r.value }));
    }
    // No element selected: pivot elements as series
    const byYear: Record<string, Record<string, number>> = {};
    for (const r of filtered) {
      if (!r.element) continue;
      if (!byYear[r.year]) byYear[r.year] = {};
      byYear[r.year][r.element] = r.value;
    }
    return Object.entries(byYear)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([year, vals]) => ({ label: year, ...vals }));
  })();

  const sclElements = [...new Set(sclRecords.map((r) => r.element).filter(Boolean))] as string[];
  const sclItemOptions = [{ value: "", label: "All items" }, ...sclItems.map((i) => ({ value: i, label: i }))];
  const sclElementOptions = [{ value: "", label: "All elements" }, ...sclElements.map((e) => ({ value: e, label: e }))];

  return (
    <div className="space-y-6">
      {/* ── Page header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <h2 className="text-2xl font-bold text-gray-900">FAO FAOSTAT</h2>
          <span className="text-2xl font-normal text-gray-500">(Ghana Food Price Indicators)</span>
        </div>

        {tab === "cpi" && (
          <SyncBtn
            label="Sync CPI Data"
            onSync={async () => {
              const result = await triggerFaoCpiSync();
              await loadCpi();
              return result;
            }}
          />
        )}
        {tab === "producer" && (
          <SyncBtn
            label="Sync Producer Prices"
            onSync={async () => {
              const result = await triggerFaoProducerSync();
              await loadItems();
              return result;
            }}
          />
        )}
        {tab === "food-security" && (
          <SyncBtn
            label="Sync Food Security"
            onSync={async () => {
              const result = await triggerFaoFoodSecuritySync();
              await loadFsItems();
              await loadFoodSecurity(fsSelectedItem || undefined);
              return result;
            }}
          />
        )}
        {tab === "crop-production" && (
          <SyncBtn
            label="Sync Crop Production"
            onSync={async () => {
              const result = await triggerFaoCropProductionSync();
              await loadCropItems();
              await fetchMoreCrop(0, true);
              return result;
            }}
          />
        )}
        {tab === "exchange-rates" && (
          <SyncBtn
            label="Sync Exchange Rates"
            onSync={async () => {
              const result = await triggerFaoExchangeRatesSync();
              await loadExchangeRates();
              return result;
            }}
          />
        )}
        {tab === "diet-cost" && (
          <SyncBtn
            label="Sync Healthy Diet Cost"
            onSync={async () => {
              const result = await triggerFaoHealthyDietSync();
              await loadDietCost();
              return result;
            }}
          />
        )}
        {tab === "value-production" && (
          <SyncBtn
            label="Sync Value of Production"
            onSync={async () => {
              const result = await triggerFaoValueProductionSync();
              await loadValueItems();
              await fetchMoreValue(0, true);
              return result;
            }}
          />
        )}
        {tab === "food-balances" && (
          <SyncBtn
            label="Sync Food Balances"
            onSync={async () => {
              const result = await triggerFaoFoodBalancesSync();
              await loadFoodBalItems();
              await fetchMoreFoodBal(0, true);
              return result;
            }}
          />
        )}
        {tab === "supply-utilization" && (
          <SyncBtn
            label="Sync Supply Utilization"
            onSync={async () => {
              const result = await triggerFaoSupplyUtilizationSync();
              await loadSclItems();
              await fetchMoreScl(0, true);
              return result;
            }}
          />
        )}
      </div>

      {/* ── Tabs ── */}
      <div className="overflow-x-auto scrollbar-hide">
        <div className="flex gap-1 rounded-full bg-gray-100 p-1 min-w-max">
          {(["cpi", "producer", "food-security", "crop-production", "exchange-rates", "diet-cost", "value-production", "food-balances", "supply-utilization"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => handleTabChange(t)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors whitespace-nowrap ${
                tab === t
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>
      </div>

      {/* ── CPI Tab ── */}
      {tab === "cpi" && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Consumer Price Indices Over Time</CardTitle>
              <CardDescription>
                Monthly data · Food &amp; General indices (2015 = 100) and Food price inflation
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingCpi ? (
                <Skeleton className="h-72 w-full" />
              ) : cpiChartData.length === 0 ? (
                <div className="flex h-72 items-center justify-center text-sm text-gray-400">
                  No CPI data — click &quot;Sync CPI Data&quot; to load
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={cpiChartData} margin={{ top: 8, right: 24, left: -20, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={Math.floor(cpiChartData.length / 10)} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={formatYAxis} />
                    <Tooltip contentStyle={{ fontSize: 12 }} formatter={(value: number, name: string) => [Number(value).toFixed(2), name]} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {CPI_SERIES.map((s) => (
                      <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} dot={false} strokeWidth={2} connectNulls />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">CPI Records</CardTitle>
              <CardDescription>{cpiRecords.length.toLocaleString()} records</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingCpi ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
                </div>
              ) : cpiRecords.length === 0 ? (
                <p className="py-8 text-center text-sm text-gray-400">
                  No data — click &quot;Sync CPI Data&quot; to load
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm whitespace-nowrap">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="pb-2 pr-4 font-medium text-muted-foreground">Date</th>
                        <th className="pb-2 pr-4 font-medium text-muted-foreground">Item</th>
                        <th className="pb-2 pr-4 font-medium text-muted-foreground">Months</th>
                        <th className="pb-2 pr-4 font-medium text-muted-foreground">Year</th>
                        <th className="pb-2 pr-4 font-medium text-muted-foreground">Element</th>
                        <th className="pb-2 pr-4 font-medium text-muted-foreground">Unit</th>
                        <th className="pb-2 pr-4 font-medium text-muted-foreground">Flag</th>
                        <th className="pb-2 pr-4 font-medium text-muted-foreground text-right">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cpiRecords.map((r) => (
                        <tr key={r.id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                          <td className="py-2 pr-4 text-xs text-muted-foreground">{r.start_date}</td>
                          <td className="py-2 pr-4 font-medium">{r.item}</td>
                          <td className="py-2 pr-4 text-xs text-muted-foreground">{r.months || "—"}</td>
                          <td className="py-2 pr-4 text-xs text-muted-foreground">{r.year ?? "—"}</td>
                          <td className="py-2 pr-4 text-xs text-muted-foreground">{r.element || "—"}</td>
                          <td className="py-2 pr-4 text-xs text-muted-foreground">{r.unit || "—"}</td>
                          <td className="py-2 pr-4 text-xs text-muted-foreground">{r.flag || "—"}</td>
                          <td className="py-2 pr-4 text-right font-mono font-semibold">{Number(r.value).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Producer Prices Tab ── */}
      {tab === "producer" && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            {items.length === 0 ? (
              <Skeleton className="h-10 w-64" />
            ) : (
              <SearchableSelect
                options={itemOptions}
                value={selectedItem}
                onValueChange={setSelectedItem}
                placeholder="Select commodity…"
                className="w-72"
              />
            )}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{selectedItem || "Producer Price Index"}</CardTitle>
              <CardDescription>Annual producer price data (GHS / tonne or as reported)</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingProducer ? (
                <Skeleton className="h-64 w-full" />
              ) : producerChartData.length === 0 ? (
                <div className="flex h-64 items-center justify-center text-sm text-gray-400">
                  {items.length === 0 ? 'No data — click "Sync Producer Prices" to load' : "No records for the selected commodity"}
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={producerChartData} margin={{ top: 8, right: 24, left: -20, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={formatYAxis} />
                    <Tooltip contentStyle={{ fontSize: 12 }} formatter={(value: number) => [Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 }), selectedItem]} />
                    <Line type="monotone" dataKey="value" name={selectedItem} stroke="#16a34a" strokeWidth={2} dot={{ r: 4, fill: "#16a34a" }} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Producer Price Records</CardTitle>
              <CardDescription>
                {selectedItem ? `${producerPrices.length.toLocaleString()} records for ${selectedItem}` : "Select a commodity above"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingProducer ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
                </div>
              ) : producerPrices.length === 0 ? (
                <p className="py-8 text-center text-sm text-gray-400">
                  {items.length === 0 ? 'No data — click "Sync Producer Prices" to load' : "No records for the selected commodity"}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm whitespace-nowrap">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="pb-2 pr-4 font-medium text-muted-foreground">Date</th>
                        <th className="pb-2 pr-4 font-medium text-muted-foreground">Item</th>
                        <th className="pb-2 pr-4 font-medium text-muted-foreground">Year</th>
                        <th className="pb-2 pr-4 font-medium text-muted-foreground">Element</th>
                        <th className="pb-2 pr-4 font-medium text-muted-foreground">Unit</th>
                        <th className="pb-2 pr-4 font-medium text-muted-foreground">Flag</th>
                        <th className="pb-2 pr-4 font-medium text-muted-foreground text-right">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {producerPrices.map((r) => (
                        <tr key={r.id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                          <td className="py-2 pr-4 text-xs text-muted-foreground">{r.start_date}</td>
                          <td className="py-2 pr-4 font-medium">{r.item}</td>
                          <td className="py-2 pr-4 text-xs text-muted-foreground">{r.year ?? "—"}</td>
                          <td className="py-2 pr-4 text-xs text-muted-foreground">{r.element || "—"}</td>
                          <td className="py-2 pr-4 text-xs text-muted-foreground">{r.unit || "—"}</td>
                          <td className="py-2 pr-4 text-xs text-muted-foreground">{r.flag || "—"}</td>
                          <td className="py-2 pr-4 text-right font-mono font-semibold">
                            {Number(r.value).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Food Security Tab ── */}
      {tab === "food-security" && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            {fsItems.length === 0 && loadingFs ? (
              <Skeleton className="h-10 w-64" />
            ) : (
              <SearchableSelect
                options={fsItemOptions}
                value={fsSelectedItem}
                onValueChange={setFsSelectedItem}
                placeholder="Filter by indicator…"
                className="w-96"
              />
            )}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Food Security Indicators Over Time</CardTitle>
              <CardDescription>
                {fsSelectedItem ? fsSelectedItem : "Top indicators — use the filter above to focus on a specific indicator"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingFs ? (
                <Skeleton className="h-72 w-full" />
              ) : fsChartData.length === 0 ? (
                <div className="flex h-72 items-center justify-center text-sm text-gray-400">
                  {fsRecords.length === 0 ? 'No data — click "Sync Food Security" to load' : "No chart series for current filter"}
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={fsChartData} margin={{ top: 8, right: 24, left: -20, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={Math.max(0, Math.floor(fsChartData.length / 8) - 1)} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={formatYAxis} />
                    <Tooltip contentStyle={{ fontSize: 12 }} formatter={(value: number, name: string) => [Number(value).toFixed(2), name]} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {[...new Set(fsChartData.flatMap((d) => Object.keys(d).filter((k) => k !== "label")))].map((key, i) => (
                      <Line key={key} type="monotone" dataKey={key} name={key} stroke={["#16a34a", "#2563eb", "#dc2626", "#d97706"][i % 4]} dot={false} strokeWidth={2} connectNulls />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Food Security Records</CardTitle>
              <CardDescription>{fsRecords.length.toLocaleString()} records</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingFs ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
                </div>
              ) : fsRecords.length === 0 ? (
                <p className="py-8 text-center text-sm text-gray-400">
                  No data — click &quot;Sync Food Security&quot; to load
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm whitespace-nowrap">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="pb-2 pr-4 font-medium text-muted-foreground">Period</th>
                        <th className="pb-2 pr-4 font-medium text-muted-foreground">Item</th>
                        <th className="pb-2 pr-4 font-medium text-muted-foreground">Element</th>
                        <th className="pb-2 pr-4 font-medium text-muted-foreground">Unit</th>
                        <th className="pb-2 pr-4 font-medium text-muted-foreground text-right">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fsRecords.map((r) => (
                        <tr key={r.id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                          <td className="py-2 pr-4 text-xs text-muted-foreground">{r.year_label}</td>
                          <td className="py-2 pr-4 font-medium">{r.item}</td>
                          <td className="py-2 pr-4 text-xs text-muted-foreground">{r.element || "—"}</td>
                          <td className="py-2 pr-4 text-xs text-muted-foreground">{r.unit || "—"}</td>
                          <td className="py-2 pr-4 text-right font-mono font-semibold">{Number(r.value).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Crop Production Tab ── */}
      {tab === "crop-production" && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            {cropItems.length === 0 && loadingCrop ? (
              <>
                <Skeleton className="h-10 w-64" />
                <Skeleton className="h-10 w-48" />
              </>
            ) : (
              <>
                <SearchableSelect
                  options={cropItemOptions}
                  value={cropSelectedItem}
                  onValueChange={setCropSelectedItem}
                  placeholder="Filter by crop…"
                  className="w-72"
                />
                <SearchableSelect
                  options={cropElementOptions}
                  value={cropSelectedElement}
                  onValueChange={setCropSelectedElement}
                  placeholder="Filter by element…"
                  className="w-56"
                />
              </>
            )}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {cropSelectedItem ? cropSelectedItem : "Crop & Livestock Production"}{cropSelectedElement ? ` — ${cropSelectedElement}` : ""}
              </CardTitle>
              <CardDescription>Annual production data for Ghana (FAO QCL)</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingCrop ? (
                <Skeleton className="h-72 w-full" />
              ) : cropChartData.length === 0 ? (
                <div className="flex h-72 items-center justify-center text-sm text-gray-400">
                  {cropRecords.length === 0 ? 'No data — click "Sync Crop Production" to load' : "No records for the selected filters"}
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={cropChartData} margin={{ top: 8, right: 24, left: -20, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={formatYAxis} />
                    <Tooltip
                      contentStyle={{ fontSize: 12 }}
                      formatter={(value: number) => [
                        Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 }),
                        cropSelectedElement || "Value",
                      ]}
                    />
                    <Line type="monotone" dataKey="value" name={cropSelectedElement || "Value"} stroke="#16a34a" strokeWidth={2} dot={{ r: 3, fill: "#16a34a" }} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Crop Production Records</CardTitle>
              <CardDescription>
                {cropRecords.length.toLocaleString()} of {cropTotal.toLocaleString()} records
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingCrop && cropRecords.length === 0 ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
                </div>
              ) : cropRecords.length === 0 ? (
                <p className="py-8 text-center text-sm text-gray-400">
                  No data — click &quot;Sync Crop Production&quot; to load
                </p>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm whitespace-nowrap">
                      <thead>
                        <tr className="border-b text-left">
                          <th className="pb-2 pr-4 font-medium text-muted-foreground">Year</th>
                          <th className="pb-2 pr-4 font-medium text-muted-foreground">Item</th>
                          <th className="pb-2 pr-4 font-medium text-muted-foreground">Element</th>
                          <th className="pb-2 pr-4 font-medium text-muted-foreground">Unit</th>
                          <th className="pb-2 pr-4 font-medium text-muted-foreground text-right">Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cropRecords.map((r) => (
                          <tr key={r.id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                            <td className="py-2 pr-4 text-xs text-muted-foreground">{r.year}</td>
                            <td className="py-2 pr-4 font-medium">{r.item}</td>
                            <td className="py-2 pr-4 text-xs text-muted-foreground">{r.element || "—"}</td>
                            <td className="py-2 pr-4 text-xs text-muted-foreground">{r.unit || "—"}</td>
                            <td className="py-2 pr-4 text-right font-mono font-semibold">
                              {Number(r.value).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {cropHasMore ? (
                    <>
                      <div ref={cropSentinelRef} className="h-4" />
                      {loadingCrop && (
                        <div className="space-y-2 pt-2">
                          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="pt-4 text-center text-xs text-gray-400">
                      All {cropTotal.toLocaleString()} records loaded
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Exchange Rates Tab ── */}
      {tab === "exchange-rates" && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Annual Exchange Rate (GHS / USD)</CardTitle>
              <CardDescription>Annual average official exchange rate — FAO PE dataset</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingEx ? (
                <Skeleton className="h-72 w-full" />
              ) : exAnnualData.length === 0 ? (
                <div className="flex h-72 items-center justify-center text-sm text-gray-400">
                  {exRecords.length === 0 ? 'No data — click "Sync Exchange Rates" to load' : "No annual records found"}
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={exAnnualData} margin={{ top: 8, right: 24, left: -20, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={formatYAxis} />
                    <Tooltip
                      contentStyle={{ fontSize: 12 }}
                      formatter={(value: number) => [Number(value).toFixed(4), "GHS/USD"]}
                    />
                    <Line type="monotone" dataKey="value" name="GHS/USD" stroke="#2563eb" strokeWidth={2} dot={{ r: 4, fill: "#2563eb" }} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Exchange Rate Records</CardTitle>
              <CardDescription>{exRecords.length.toLocaleString()} records</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingEx ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
                </div>
              ) : exRecords.length === 0 ? (
                <p className="py-8 text-center text-sm text-gray-400">
                  No data — click &quot;Sync Exchange Rates&quot; to load
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm whitespace-nowrap">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="pb-2 pr-4 font-medium text-muted-foreground">Year</th>
                        <th className="pb-2 pr-4 font-medium text-muted-foreground">Months</th>
                        <th className="pb-2 pr-4 font-medium text-muted-foreground">Element</th>
                        <th className="pb-2 pr-4 font-medium text-muted-foreground">Currency</th>
                        <th className="pb-2 pr-4 font-medium text-muted-foreground">ISO Code</th>
                        <th className="pb-2 pr-4 font-medium text-muted-foreground">Unit</th>
                        <th className="pb-2 pr-4 font-medium text-muted-foreground text-right">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {exRecords.map((r) => (
                        <tr key={r.id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                          <td className="py-2 pr-4 text-xs text-muted-foreground">{r.year}</td>
                          <td className="py-2 pr-4 text-xs text-muted-foreground">{r.months || "—"}</td>
                          <td className="py-2 pr-4 font-medium">{r.element || "—"}</td>
                          <td className="py-2 pr-4 text-xs text-muted-foreground">{r.currency || "—"}</td>
                          <td className="py-2 pr-4 text-xs text-muted-foreground">{r.iso_currency_code || "—"}</td>
                          <td className="py-2 pr-4 text-xs text-muted-foreground">{r.unit || "—"}</td>
                          <td className="py-2 pr-4 text-right font-mono font-semibold">{Number(r.value).toFixed(4)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Healthy Diet Cost Tab ── */}
      {tab === "diet-cost" && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Cost of a Healthy Diet Over Time</CardTitle>
              <CardDescription>Annual cost indicators — FAO CAHD dataset</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingDiet ? (
                <Skeleton className="h-72 w-full" />
              ) : dietChartData.length === 0 ? (
                <div className="flex h-72 items-center justify-center text-sm text-gray-400">
                  {dietRecords.length === 0 ? 'No data — click "Sync Healthy Diet Cost" to load' : "No data available"}
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={dietChartData} margin={{ top: 8, right: 24, left: -20, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={formatYAxis} />
                    <Tooltip contentStyle={{ fontSize: 12 }} formatter={(value: number, name: string) => [Number(value).toFixed(2), name]} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {dietItems.map((item, i) => (
                      <Bar key={item} dataKey={item} name={item} fill={dietColors[i % dietColors.length]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Healthy Diet Cost Records</CardTitle>
              <CardDescription>{dietRecords.length.toLocaleString()} records</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingDiet ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
                </div>
              ) : dietRecords.length === 0 ? (
                <p className="py-8 text-center text-sm text-gray-400">
                  No data — click &quot;Sync Healthy Diet Cost&quot; to load
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm whitespace-nowrap">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="pb-2 pr-4 font-medium text-muted-foreground">Year</th>
                        <th className="pb-2 pr-4 font-medium text-muted-foreground">Item</th>
                        <th className="pb-2 pr-4 font-medium text-muted-foreground">Element</th>
                        <th className="pb-2 pr-4 font-medium text-muted-foreground">Release</th>
                        <th className="pb-2 pr-4 font-medium text-muted-foreground">Unit</th>
                        <th className="pb-2 pr-4 font-medium text-muted-foreground text-right">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dietRecords.map((r) => (
                        <tr key={r.id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                          <td className="py-2 pr-4 text-xs text-muted-foreground">{r.year}</td>
                          <td className="py-2 pr-4 font-medium">{r.item}</td>
                          <td className="py-2 pr-4 text-xs text-muted-foreground">{r.element || "—"}</td>
                          <td className="py-2 pr-4 text-xs text-muted-foreground">{r.release || "—"}</td>
                          <td className="py-2 pr-4 text-xs text-muted-foreground">{r.unit || "—"}</td>
                          <td className="py-2 pr-4 text-right font-mono font-semibold">{Number(r.value).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Value of Production Tab ── */}
      {tab === "value-production" && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            {valueItems.length === 0 && loadingValue ? (
              <>
                <Skeleton className="h-10 w-64" />
                <Skeleton className="h-10 w-48" />
              </>
            ) : (
              <>
                <SearchableSelect
                  options={valueItemOptions}
                  value={valueSelectedItem}
                  onValueChange={setValueSelectedItem}
                  placeholder="Filter by item…"
                  className="w-72"
                />
                <SearchableSelect
                  options={valueElementOptions}
                  value={valueSelectedElement}
                  onValueChange={setValueSelectedElement}
                  placeholder="Filter by element…"
                  className="w-56"
                />
              </>
            )}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {valueSelectedItem ? valueSelectedItem : "Value of Agricultural Production"}{valueSelectedElement ? ` — ${valueSelectedElement}` : ""}
              </CardTitle>
              <CardDescription>Annual value data for Ghana (FAO QV)</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingValue ? (
                <Skeleton className="h-72 w-full" />
              ) : valueChartData.length === 0 ? (
                <div className="flex h-72 items-center justify-center text-sm text-gray-400">
                  {valueRecords.length === 0 ? 'No data — click "Sync Value of Production" to load' : "No records for the selected filters"}
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={valueChartData} margin={{ top: 8, right: 24, left: -20, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={formatYAxis} />
                    <Tooltip
                      contentStyle={{ fontSize: 12 }}
                      formatter={(value: number) => [
                        Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 }),
                        valueSelectedElement || "Value",
                      ]}
                    />
                    <Line type="monotone" dataKey="value" name={valueSelectedElement || "Value"} stroke="#7c3aed" strokeWidth={2} dot={{ r: 3, fill: "#7c3aed" }} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Value of Production Records</CardTitle>
              <CardDescription>
                {valueRecords.length.toLocaleString()} of {valueTotal.toLocaleString()} records
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingValue && valueRecords.length === 0 ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
                </div>
              ) : valueRecords.length === 0 ? (
                <p className="py-8 text-center text-sm text-gray-400">
                  No data — click &quot;Sync Value of Production&quot; to load
                </p>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm whitespace-nowrap">
                      <thead>
                        <tr className="border-b text-left">
                          <th className="pb-2 pr-4 font-medium text-muted-foreground">Year</th>
                          <th className="pb-2 pr-4 font-medium text-muted-foreground">Item</th>
                          <th className="pb-2 pr-4 font-medium text-muted-foreground">Element</th>
                          <th className="pb-2 pr-4 font-medium text-muted-foreground">Unit</th>
                          <th className="pb-2 pr-4 font-medium text-muted-foreground text-right">Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {valueRecords.map((r) => (
                          <tr key={r.id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                            <td className="py-2 pr-4 text-xs text-muted-foreground">{r.year}</td>
                            <td className="py-2 pr-4 font-medium">{r.item}</td>
                            <td className="py-2 pr-4 text-xs text-muted-foreground">{r.element || "—"}</td>
                            <td className="py-2 pr-4 text-xs text-muted-foreground">{r.unit || "—"}</td>
                            <td className="py-2 pr-4 text-right font-mono font-semibold">
                              {Number(r.value).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {valueHasMore ? (
                    <>
                      <div ref={valueSentinelRef} className="h-4" />
                      {loadingValue && (
                        <div className="space-y-2 pt-2">
                          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="pt-4 text-center text-xs text-gray-400">
                      All {valueTotal.toLocaleString()} records loaded
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Food Balances Tab ── */}
      {tab === "food-balances" && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            {foodBalItems.length === 0 && loadingFoodBal ? (
              <>
                <Skeleton className="h-10 w-64" />
                <Skeleton className="h-10 w-48" />
              </>
            ) : (
              <>
                <SearchableSelect
                  options={foodBalItemOptions}
                  value={foodBalSelectedItem}
                  onValueChange={setFoodBalSelectedItem}
                  placeholder="Filter by item…"
                  className="w-72"
                />
                <SearchableSelect
                  options={foodBalElementOptions}
                  value={foodBalSelectedElement}
                  onValueChange={setFoodBalSelectedElement}
                  placeholder="Filter by element…"
                  className="w-56"
                />
              </>
            )}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {foodBalSelectedItem ? foodBalSelectedItem : "Food Balances"}{foodBalSelectedElement ? ` — ${foodBalSelectedElement}` : ""}
              </CardTitle>
              <CardDescription>Annual food supply &amp; balance data for Ghana (FAO FBS)</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingFoodBal ? (
                <Skeleton className="h-72 w-full" />
              ) : foodBalChartData.length === 0 ? (
                <div className="flex h-72 items-center justify-center text-sm text-gray-400">
                  {foodBalRecords.length === 0 ? 'No data — click "Sync Food Balances" to load' : "No records for the selected filters"}
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={foodBalChartData} margin={{ top: 8, right: 24, left: -20, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={formatYAxis} />
                    <Tooltip
                      contentStyle={{ fontSize: 12 }}
                      formatter={(value: number) => [
                        Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 }),
                        foodBalSelectedElement || "Value",
                      ]}
                    />
                    <Line type="monotone" dataKey="value" name={foodBalSelectedElement || "Value"} stroke="#0891b2" strokeWidth={2} dot={{ r: 3, fill: "#0891b2" }} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Food Balance Records</CardTitle>
              <CardDescription>
                {foodBalRecords.length.toLocaleString()} of {foodBalTotal.toLocaleString()} records
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingFoodBal && foodBalRecords.length === 0 ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
                </div>
              ) : foodBalRecords.length === 0 ? (
                <p className="py-8 text-center text-sm text-gray-400">
                  No data — click &quot;Sync Food Balances&quot; to load
                </p>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm whitespace-nowrap">
                      <thead>
                        <tr className="border-b text-left">
                          <th className="pb-2 pr-4 font-medium text-muted-foreground">Year</th>
                          <th className="pb-2 pr-4 font-medium text-muted-foreground">Item</th>
                          <th className="pb-2 pr-4 font-medium text-muted-foreground">Element</th>
                          <th className="pb-2 pr-4 font-medium text-muted-foreground">Unit</th>
                          <th className="pb-2 pr-4 font-medium text-muted-foreground text-right">Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {foodBalRecords.map((r) => (
                          <tr key={r.id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                            <td className="py-2 pr-4 text-xs text-muted-foreground">{r.year}</td>
                            <td className="py-2 pr-4 font-medium">{r.item}</td>
                            <td className="py-2 pr-4 text-xs text-muted-foreground">{r.element || "—"}</td>
                            <td className="py-2 pr-4 text-xs text-muted-foreground">{r.unit || "—"}</td>
                            <td className="py-2 pr-4 text-right font-mono font-semibold">
                              {Number(r.value).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {foodBalHasMore ? (
                    <>
                      <div ref={foodBalSentinelRef} className="h-4" />
                      {loadingFoodBal && (
                        <div className="space-y-2 pt-2">
                          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="pt-4 text-center text-xs text-gray-400">
                      All {foodBalTotal.toLocaleString()} records loaded
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Supply Utilization Tab ── */}
      {tab === "supply-utilization" && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            {sclItems.length === 0 && loadingScl ? (
              <>
                <Skeleton className="h-10 w-64" />
                <Skeleton className="h-10 w-48" />
              </>
            ) : (
              <>
                <SearchableSelect
                  options={sclItemOptions}
                  value={sclSelectedItem}
                  onValueChange={setSclSelectedItem}
                  placeholder="Filter by item…"
                  className="w-72"
                />
                <SearchableSelect
                  options={sclElementOptions}
                  value={sclSelectedElement}
                  onValueChange={setSclSelectedElement}
                  placeholder="Filter by element…"
                  className="w-56"
                />
              </>
            )}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {sclSelectedItem ? sclSelectedItem : "Supply Utilization Accounts"}{sclSelectedElement ? ` — ${sclSelectedElement}` : ""}
              </CardTitle>
              <CardDescription>
                Annual food use, feed, processing, waste &amp; losses for Ghana (FAO SCL)
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingScl ? (
                <Skeleton className="h-72 w-full" />
              ) : sclChartData.length === 0 ? (
                <div className="flex h-72 items-center justify-center text-sm text-gray-400">
                  {sclRecords.length === 0 ? 'No data — click "Sync Supply Utilization" to load' : "No records for the selected filters"}
                </div>
              ) : sclSelectedElement ? (
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={sclChartData} margin={{ top: 8, right: 24, left: -20, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={formatYAxis} />
                    <Tooltip
                      contentStyle={{ fontSize: 12 }}
                      formatter={(value: number) => [
                        Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 }),
                        sclSelectedElement,
                      ]}
                    />
                    <Line type="monotone" dataKey="value" name={sclSelectedElement} stroke="#16a34a" strokeWidth={2} dot={{ r: 3, fill: "#16a34a" }} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={sclChartData} margin={{ top: 8, right: 24, left: -20, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={formatYAxis} />
                    <Tooltip contentStyle={{ fontSize: 12 }} formatter={(value: number, name: string) => [Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 }), name]} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {[...new Set(sclChartData.flatMap((d) => Object.keys(d).filter((k) => k !== "label")))].map((key, i) => (
                      <Bar key={key} dataKey={key} name={key} fill={dietColors[i % dietColors.length]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Supply Utilization Records</CardTitle>
              <CardDescription>
                {sclRecords.length.toLocaleString()} of {sclTotal.toLocaleString()} records
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingScl && sclRecords.length === 0 ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
                </div>
              ) : sclRecords.length === 0 ? (
                <p className="py-8 text-center text-sm text-gray-400">
                  No data — click &quot;Sync Supply Utilization&quot; to load
                </p>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm whitespace-nowrap">
                      <thead>
                        <tr className="border-b text-left">
                          <th className="pb-2 pr-4 font-medium text-muted-foreground">Year</th>
                          <th className="pb-2 pr-4 font-medium text-muted-foreground">Item</th>
                          <th className="pb-2 pr-4 font-medium text-muted-foreground">Element</th>
                          <th className="pb-2 pr-4 font-medium text-muted-foreground">Unit</th>
                          <th className="pb-2 pr-4 font-medium text-muted-foreground text-right">Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sclRecords.map((r) => (
                          <tr
                            key={r.id}
                            onClick={() => setSclSidebarRecord(r)}
                            className="border-b last:border-0 hover:bg-muted/50 transition-colors cursor-pointer"
                          >
                            <td className="py-2 pr-4 text-xs text-muted-foreground">{r.year}</td>
                            <td className="py-2 pr-4 font-medium">
                              {r.item.length > 28 ? `${r.item.slice(0, 28)}…` : r.item}
                            </td>
                            <td className="py-2 pr-4 text-xs text-muted-foreground">{r.element || "—"}</td>
                            <td className="py-2 pr-4 text-xs text-muted-foreground">{r.unit || "—"}</td>
                            <td className="py-2 pr-4 text-right font-mono font-semibold">
                              {Number(r.value).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {sclHasMore ? (
                    <>
                      <div ref={sclSentinelRef} className="h-4" />
                      {loadingScl && (
                        <div className="space-y-2 pt-2">
                          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="pt-4 text-center text-xs text-gray-400">
                      All {sclTotal.toLocaleString()} records loaded
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Supply Utilization detail sidebar ── */}
      {sclSidebarRecord && (
        <>
          {/* panel */}
          <div className="fixed right-0 top-0 z-50 h-screen w-80 bg-white shadow-xl flex flex-col !mt-0 border-l border-gray-200">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <h3 className="font-semibold text-gray-900 text-sm">Record Details</h3>
              <button
                onClick={() => setSclSidebarRecord(null)}
                className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 text-sm">
              <div>
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Item</p>
                <p className="text-gray-900">{sclSidebarRecord.item}</p>
              </div>
              {sclSidebarRecord.item_code && (
                <div>
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Item Code</p>
                  <p className="text-gray-900 font-mono">{sclSidebarRecord.item_code}</p>
                </div>
              )}
              <div>
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Year</p>
                <p className="text-gray-900">{sclSidebarRecord.year}</p>
              </div>
              {sclSidebarRecord.element && (
                <div>
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Element</p>
                  <p className="text-gray-900">{sclSidebarRecord.element}</p>
                </div>
              )}
              {sclSidebarRecord.element_code && (
                <div>
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Element Code</p>
                  <p className="text-gray-900 font-mono">{sclSidebarRecord.element_code}</p>
                </div>
              )}
              {sclSidebarRecord.unit && (
                <div>
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Unit</p>
                  <p className="text-gray-900">{sclSidebarRecord.unit}</p>
                </div>
              )}
              <div>
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Value</p>
                <p className="text-2xl font-bold text-gray-900">
                  {Number(sclSidebarRecord.value).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  {sclSidebarRecord.unit && (
                    <span className="text-sm font-normal text-gray-400 ml-1">{sclSidebarRecord.unit}</span>
                  )}
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function FaoPage() {
  return (
    <Suspense>
      <FaoPageInner />
    </Suspense>
  );
}
