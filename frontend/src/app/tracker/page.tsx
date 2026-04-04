"use client";

import { useEffect, useState } from "react";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  getFaoCropProduction,
  getFaoFoodBalances,
  getFaoPopulation,
  getFaoFoodSecurity,
  getFaoHealthyDietCost,
  getFaoLandUse,
  getFaoFertilizer,
  getFaoProducerPrices,
  getFaoCpi,
  getFaoTrade,
  getGssCropProduction,
  getGssCrops,
  getPriceSummary,
  getPriceTimeseries,
  type FaoCropProduction,
  type FaoFoodBalance,
  type FaoFoodSecurity,
  type FaoPopulation,
  type FaoHealthyDietCost,
  type FaoLandUse,
  type FaoFertilizer,
  type FaoProducerPrice,
  type FaoCpiRecord,
  type FaoTrade,
  type GssCropProduction,
  type PriceSummary,
  type TimeseriesPoint,
} from "@/lib/api";

function fmtNum(n: number, d = 0) {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(d);
}

function Section({ title, description }: { title: string; description: string }) {
  return (
    <div className="border-b border-gray-200 pb-3">
      <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
      <p className="text-sm text-gray-500">{description}</p>
    </div>
  );
}

function Empty({ message, height = 240 }: { message: string; height?: number }) {
  return (
    <div className="flex items-center justify-center text-sm text-gray-400" style={{ height }}>
      {message}
    </div>
  );
}

const CHART_COLORS = ["#16a34a", "#2563eb", "#d97706", "#dc2626", "#7c3aed", "#0891b2"];

export default function TrackerPage() {
  const [cropItems, setCropItems] = useState<string[]>([]);
  const [selectedCrop, setSelectedCrop] = useState("Maize");

  // Supply
  const [cropProduction, setCropProduction] = useState<FaoCropProduction[]>([]);
  const [gssProd, setGssProd] = useState<GssCropProduction[]>([]);
  const [foodBalances, setFoodBalances] = useState<FaoFoodBalance[]>([]);

  // Supply (static / national)
  const [landUse, setLandUse] = useState<FaoLandUse[]>([]);
  const [fertilizer, setFertilizer] = useState<FaoFertilizer[]>([]);

  // Demand (mostly static / national)
  const [population, setPopulation] = useState<FaoPopulation[]>([]);
  const [foodSecurity, setFoodSecurity] = useState<FaoFoodSecurity[]>([]);
  const [healthyDietCost, setHealthyDietCost] = useState<FaoHealthyDietCost[]>([]);

  // Prices
  const [wfpTimeseries, setWfpTimeseries] = useState<TimeseriesPoint[]>([]);
  const [producerPrices, setProducerPrices] = useState<FaoProducerPrice[]>([]);
  const [cpi, setCpi] = useState<FaoCpiRecord[]>([]);
  const [priceSummary, setPriceSummary] = useState<PriceSummary[]>([]);

  // Trade
  const [trade, setTrade] = useState<FaoTrade[]>([]);

  const [loadingCrop, setLoadingCrop] = useState(true);
  const [loadingStatic, setLoadingStatic] = useState(true);

  // Static / national data — load once
  useEffect(() => {
    async function loadStatic() {
      const [pop, sec, diet, px, lu, fert] = await Promise.all([
        getFaoPopulation("Total Population - Both sexes"),
        getFaoFoodSecurity(),
        getFaoHealthyDietCost(),
        getPriceSummary(),
        getFaoLandUse("", "Area", 200, 0),
        getFaoFertilizer(undefined, "Agricultural Use", 200, 0),
      ]);
      setPopulation(pop);
      setFoodSecurity(sec);
      setHealthyDietCost(diet);
      setPriceSummary(px);
      setLandUse(lu.data);
      setFertilizer(fert.data);
      setLoadingStatic(false);
    }
    loadStatic();
    getGssCrops().then(crops => {
      setCropItems(crops.filter(c => c));
    });
  }, []);

  // Crop-specific data — reload on crop change
  useEffect(() => {
    if (!selectedCrop) return;
    setLoadingCrop(true);
    async function loadCrop() {
      const [prod, bal, tr, gss, prodPx, cpiData, wfpTs] = await Promise.all([
        getFaoCropProduction(selectedCrop, undefined, 500, 0),
        getFaoFoodBalances(selectedCrop, undefined, 500, 0),
        getFaoTrade(selectedCrop, undefined, 1000, 0),
        getGssCropProduction({ crop: selectedCrop, element: "Production", limit: 500 }),
        getFaoProducerPrices(selectedCrop),
        getFaoCpi(selectedCrop),
        getPriceTimeseries(selectedCrop).catch(() => []),
      ]);
      setCropProduction(prod.data);
      setFoodBalances(bal.data);
      setTrade(tr.data);
      setGssProd(gss.data);
      setProducerPrices(prodPx);
      setCpi(cpiData);
      setWfpTimeseries(wfpTs);
      setLoadingCrop(false);
    }
    loadCrop();
  }, [selectedCrop]);

  // ── Supply ────────────────────────────────────────────────────────────────────

  const productionTrend = (() => {
    const byYear: Record<number, { year: number; production?: number; area?: number; yield?: number }> = {};
    for (const d of cropProduction) {
      if (!byYear[d.year]) byYear[d.year] = { year: d.year };
      if (d.element === "Production") byYear[d.year].production = d.value;
      else if (d.element === "Area harvested") byYear[d.year].area = d.value;
      else if (d.element?.includes("Yield")) byYear[d.year].yield = d.value;
    }
    return Object.values(byYear).sort((a, b) => a.year - b.year);
  })();

  const latestProd = productionTrend.length ? productionTrend[productionTrend.length - 1] : null;

  const regionalProd = (() => {
    const byRegion: Record<string, number> = {};
    for (const d of gssProd) {
      if (d.value != null) byRegion[d.region] = (byRegion[d.region] ?? 0) + d.value;
    }
    return Object.entries(byRegion)
      .sort(([, a], [, b]) => b - a)
      .map(([region, value]) => ({ region, value }));
  })();

  const BALANCE_KEYS = ["Production", "Import quantity", "Export quantity", "Food", "Losses"];
  const balanceTrend = (() => {
    const byYear: Record<number, Record<string, number>> = {};
    for (const d of foodBalances) {
      if (!BALANCE_KEYS.includes(d.element ?? "")) continue;
      if (!byYear[d.year]) byYear[d.year] = {};
      byYear[d.year][d.element!] = d.value;
    }
    return Object.entries(byYear)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([year, vals]) => ({ year: Number(year), ...vals }));
  })();

  // ── Demand ────────────────────────────────────────────────────────────────────

  // Land use chart: key area items over time
  const LAND_USE_ITEMS = ["Cropland", "Agricultural land", "Arable land"];
  const landUseByYear: Record<number, Record<string, number>> = {};
  for (const d of landUse) {
    if (!LAND_USE_ITEMS.includes(d.item)) continue;
    if (!landUseByYear[d.year]) landUseByYear[d.year] = {};
    landUseByYear[d.year][d.item] = d.value;
  }
  const landUseChartData = Object.entries(landUseByYear)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([year, vals]) => ({ year: Number(year), ...vals }));

  // Fertilizer chart: N, P, K agricultural use over time
  const fertByYear: Record<number, Record<string, number>> = {};
  for (const d of fertilizer) {
    if (!fertByYear[d.year]) fertByYear[d.year] = {};
    const shortName = d.item.includes("nitrogen") ? "Nitrogen (N)"
      : d.item.includes("phosphate") ? "Phosphate (P₂O₅)"
      : d.item.includes("potash") ? "Potash (K₂O)"
      : d.item;
    fertByYear[d.year][shortName] = d.value;
  }
  const fertChartData = Object.entries(fertByYear)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([year, vals]) => ({ year: Number(year), ...vals }));

  const foodSupplyPerCapita = foodBalances
    .filter(d => d.element === "Food supply quantity (kg/capita/yr)")
    .sort((a, b) => a.year - b.year)
    .map(d => ({ year: d.year, value: d.value }));

  const latestFoodSupply = foodSupplyPerCapita.length
    ? foodSupplyPerCapita[foodSupplyPerCapita.length - 1]
    : null;

  const popTrend = [...population]
    .sort((a, b) => a.year - b.year)
    .map(d => ({ year: d.year, value: d.value }));

  const latestPop = popTrend.length ? popTrend[popTrend.length - 1] : null;

  const undernourishedSeries = foodSecurity
    .filter(d => d.item?.toLowerCase().includes("prevalence of undernourishment"))
    .sort((a, b) => (a.year_start ?? 0) - (b.year_start ?? 0));

  const latestUndernourished = undernourishedSeries.length
    ? undernourishedSeries[undernourishedSeries.length - 1]
    : null;

  // Group healthy diet cost by item
  const dietItems = [...new Set(healthyDietCost.map(d => d.item))];
  const dietByYear: Record<number, Record<string, number>> = {};
  for (const d of healthyDietCost) {
    if (!dietByYear[d.year]) dietByYear[d.year] = {};
    dietByYear[d.year][d.item] = d.value;
  }
  const dietChartData = Object.entries(dietByYear)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([year, vals]) => ({ year: Number(year), ...vals }));

  // ── Prices ────────────────────────────────────────────────────────────────────

  const wfpChartData = [...wfpTimeseries]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(d => ({ date: d.date.slice(0, 7), price: d.avg_price }));

  const producerTrend = [...producerPrices]
    .sort((a, b) => a.start_date.localeCompare(b.start_date))
    .map(d => ({ year: new Date(d.start_date).getFullYear(), value: d.value }));

  const cpiTrend = [...cpi]
    .sort((a, b) => a.start_date.localeCompare(b.start_date))
    .map(d => ({ period: d.months ? `${d.year} ${d.months}` : String(d.year), value: d.value }));

  const cropKeyword = selectedCrop.toLowerCase().split(",")[0].split(" ")[0];
  const matchedPrices = priceSummary.filter(
    p =>
      p.commodity_name.toLowerCase().includes(cropKeyword) ||
      cropKeyword.includes(p.commodity_name.toLowerCase())
  );

  // ── Trade ─────────────────────────────────────────────────────────────────────

  const tradeTrend = (() => {
    const byYear: Record<number, { year: number; imports?: number; exports?: number }> = {};
    for (const d of trade) {
      if (!byYear[d.year]) byYear[d.year] = { year: d.year };
      const el = d.element?.toLowerCase();
      if (el === "import quantity") byYear[d.year].imports = (byYear[d.year].imports ?? 0) + d.value;
      else if (el === "export quantity") byYear[d.year].exports = (byYear[d.year].exports ?? 0) + d.value;
    }
    return Object.values(byYear).sort((a, b) => a.year - b.year);
  })();

  const cropOptions = cropItems.map(i => ({ value: i, label: i }));

  return (
    <div className="space-y-10">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Demand &amp; Supply Tracker</h2>
          <p className="mt-1 text-sm text-gray-500">
            Select a crop to explore its supply, demand, prices, and trade signals
          </p>
        </div>
        <SearchableSelect
          options={cropOptions}
          value={selectedCrop}
          onValueChange={setSelectedCrop}
          placeholder="Select crop"
          className="w-64"
        />
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Production", value: latestProd?.production != null ? `${fmtNum(latestProd.production)} t` : "—", sub: latestProd ? `${latestProd.year}` : "No data", color: "text-green-700", bg: "bg-green-50", border: "border-green-200" },
          { label: "Area Harvested", value: latestProd?.area != null ? `${fmtNum(latestProd.area)} ha` : "—", sub: latestProd ? `${latestProd.year}` : "No data", color: "text-blue-700", bg: "bg-blue-50", border: "border-blue-200" },
          { label: "Food Supply / Capita", value: latestFoodSupply ? `${latestFoodSupply.value.toFixed(1)} kg/yr` : "—", sub: latestFoodSupply ? `${latestFoodSupply.year}` : "No data", color: "text-amber-700", bg: "bg-amber-50", border: "border-amber-200" },
          { label: "Undernourishment", value: latestUndernourished ? `${latestUndernourished.value}%` : "—", sub: latestUndernourished?.year_label ?? "No data", color: "text-red-700", bg: "bg-red-50", border: "border-red-200" },
        ].map(({ label, value, sub, color, bg, border }) => (
          <div key={label} className={`rounded-2xl border ${bg} ${border} p-5`}>
            <p className="text-xs font-medium text-gray-500 mb-1">{label}</p>
            {loadingCrop && label !== "Undernourishment" ? (
              <Skeleton className="h-7 w-24 mt-1" />
            ) : (
              <>
                <p className={`text-2xl font-bold ${color}`}>{value}</p>
                <p className="text-xs text-gray-400 mt-1">{sub}</p>
              </>
            )}
          </div>
        ))}
      </div>

      {/* ── SUPPLY ─────────────────────────────────────────────────────────────── */}
      <div className="space-y-6">
        <Section title="Supply" description="Production volume, area harvested, regional breakdown, and domestic balance" />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Production Trend</CardTitle>
              <CardDescription>Volume (tonnes) and area harvested (ha) — FAO</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingCrop ? <Skeleton className="h-56 w-full" /> : productionTrend.length === 0 ? (
                <Empty message="No data — sync FAO Crop Production" />
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={productionTrend} margin={{ top: 4, right: 20, left: -16, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                    <YAxis yAxisId="prod" tick={{ fontSize: 10 }} tickFormatter={v => fmtNum(v)} />
                    <YAxis yAxisId="area" orientation="right" tick={{ fontSize: 10 }} tickFormatter={v => fmtNum(v)} />
                    <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number, n: string) => [`${fmtNum(v)} ${n.includes("area") ? "ha" : "t"}`, n]} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line yAxisId="prod" type="monotone" dataKey="production" name="Production (t)" stroke="#16a34a" dot={false} strokeWidth={2} />
                    <Line yAxisId="area" type="monotone" dataKey="area" name="Area harvested (ha)" stroke="#2563eb" dot={false} strokeWidth={2} strokeDasharray="4 2" />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Regional Production</CardTitle>
              <CardDescription>Total production by region — GSS sub-national data</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingCrop ? <Skeleton className="h-56 w-full" /> : regionalProd.length === 0 ? (
                <Empty message="No data — upload GSS CSV" />
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={regionalProd} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => fmtNum(v)} />
                    <YAxis type="category" dataKey="region" tick={{ fontSize: 10 }} width={90} />
                    <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number) => [`${fmtNum(v)} t`, "Production"]} />
                    <Bar dataKey="value" fill="#16a34a" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Food Balance</CardTitle>
            <CardDescription>Domestic supply = Production + Imports − Exports − Losses (tonnes) — FAO</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingCrop ? <Skeleton className="h-56 w-full" /> : balanceTrend.length === 0 ? (
              <Empty message="No data — sync FAO Food Balances" height={200} />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={balanceTrend} margin={{ top: 4, right: 16, left: -16, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={v => fmtNum(v)} />
                  <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number, n: string) => [`${fmtNum(v)} t`, n]} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {BALANCE_KEYS.map((key, i) => (
                    <Line key={key} type="monotone" dataKey={key} stroke={CHART_COLORS[i]} dot={false} strokeWidth={2} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Land Use</CardTitle>
              <CardDescription>Cropland, agricultural land, and arable land (1000 ha) — FAO</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingStatic ? <Skeleton className="h-56 w-full" /> : landUseChartData.length === 0 ? (
                <Empty message="No data — sync FAO Land Use" />
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={landUseChartData} margin={{ top: 4, right: 16, left: -16, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={v => fmtNum(v)} />
                    <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number, n: string) => [`${fmtNum(v)} 1000 ha`, n]} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {LAND_USE_ITEMS.map((item, i) => (
                      <Line key={item} type="monotone" dataKey={item} stroke={CHART_COLORS[i]} dot={false} strokeWidth={2} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Fertilizer Use</CardTitle>
              <CardDescription>Agricultural use of N, P, K nutrients (tonnes) — FAO</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingStatic ? <Skeleton className="h-56 w-full" /> : fertChartData.length === 0 ? (
                <Empty message="No data — sync FAO Fertilizer" />
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={fertChartData} margin={{ top: 4, right: 16, left: -16, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={v => fmtNum(v)} />
                    <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number, n: string) => [`${fmtNum(v)} t`, n]} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {["Nitrogen (N)", "Phosphate (P₂O₅)", "Potash (K₂O)"].map((item, i) => (
                      <Line key={item} type="monotone" dataKey={item} stroke={CHART_COLORS[i]} dot={false} strokeWidth={2} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>
      </div>  {/* end Supply */}

      {/* ── DEMAND ─────────────────────────────────────────────────────────────── */}
      <div className="space-y-6">
        <Section title="Demand" description="Consumption per capita, population growth, food security, and diet cost" />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Food Supply per Capita</CardTitle>
              <CardDescription>kg/capita/year — FAO Food Balances</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingCrop ? <Skeleton className="h-56 w-full" /> : foodSupplyPerCapita.length === 0 ? (
                <Empty message="No data — sync FAO Food Balances" />
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={foodSupplyPerCapita} margin={{ top: 4, right: 16, left: -16, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 10 }} unit=" kg" />
                    <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number) => [`${v.toFixed(1)} kg/yr`, "Food supply"]} />
                    <Line type="monotone" dataKey="value" name="Food supply/capita" stroke="#d97706" dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Prevalence of Undernourishment</CardTitle>
              <CardDescription>% of population — national indicator (FAO Food Security)</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingStatic ? <Skeleton className="h-56 w-full" /> : undernourishedSeries.length === 0 ? (
                <Empty message="No data — sync FAO Food Security" />
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart
                    data={undernourishedSeries.map(d => ({ label: d.year_label, value: d.value }))}
                    margin={{ top: 4, right: 16, left: -16, bottom: 50 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 9 }} angle={-35} textAnchor="end" interval={0} />
                    <YAxis tick={{ fontSize: 10 }} unit="%" />
                    <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number) => [`${v}%`, "Undernourished"]} />
                    <Bar dataKey="value" fill="#dc2626" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Population Growth</CardTitle>
              <CardDescription>Total population — FAO</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingStatic ? <Skeleton className="h-56 w-full" /> : popTrend.length === 0 ? (
                <Empty message="No data — sync FAO Population" />
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={popTrend} margin={{ top: 4, right: 16, left: -16, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={v => fmtNum(v * 1000)} />
                    <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number) => [fmtNum(v * 1000), "Population"]} />
                    <Line type="monotone" dataKey="value" name="Population" stroke="#7c3aed" dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Cost of a Healthy Diet</CardTitle>
              <CardDescription>USD/person/day — national indicator (FAO)</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingStatic ? <Skeleton className="h-56 w-full" /> : dietChartData.length === 0 ? (
                <Empty message="No data — sync FAO Healthy Diet Cost" />
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={dietChartData} margin={{ top: 4, right: 16, left: -16, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip contentStyle={{ fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {dietItems.slice(0, 4).map((item, i) => (
                      <Line key={item} type="monotone" dataKey={item} stroke={CHART_COLORS[i]} dot={false} strokeWidth={2} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── PRICES ─────────────────────────────────────────────────────────────── */}
      <div className="space-y-6">
        <Section title="Prices" description="Retail market prices, farmgate producer prices, and consumer price index" />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">WFP Retail Price Trend</CardTitle>
              <CardDescription>Monthly average price across Ghana markets (GHS)</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingCrop ? <Skeleton className="h-56 w-full" /> : wfpChartData.length === 0 ? (
                <Empty message="No matching WFP price data — sync WFP Food Prices" />
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={wfpChartData} margin={{ top: 4, right: 16, left: -16, bottom: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 9 }} angle={-35} textAnchor="end" interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={v => fmtNum(v)} />
                    <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number) => [`GHS ${v.toFixed(2)}`, "Avg price"]} />
                    <Line type="monotone" dataKey="price" name="Retail price" stroke="#0891b2" dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Producer Price (Farmgate)</CardTitle>
              <CardDescription>Annual average — FAO Producer Prices</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingCrop ? <Skeleton className="h-56 w-full" /> : producerTrend.length === 0 ? (
                <Empty message="No data — sync FAO Producer Prices" />
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={producerTrend} margin={{ top: 4, right: 16, left: -16, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number) => [v.toFixed(2), "Producer price"]} />
                    <Line type="monotone" dataKey="value" name="Producer price" stroke="#7c3aed" dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Consumer Price Index (CPI)</CardTitle>
              <CardDescription>Food CPI — FAO</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingCrop ? <Skeleton className="h-56 w-full" /> : cpiTrend.length === 0 ? (
                <Empty message="No data — sync FAO CPI" />
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={cpiTrend} margin={{ top: 4, right: 16, left: -16, bottom: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="period" tick={{ fontSize: 9 }} angle={-35} textAnchor="end" interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number) => [v.toFixed(1), "CPI"]} />
                    <Line type="monotone" dataKey="value" name="CPI" stroke="#dc2626" dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Current Market Prices</CardTitle>
              <CardDescription>Latest WFP retail prices with 30-day change</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingStatic ? (
                <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
              ) : matchedPrices.length === 0 ? (
                <Empty message="No matching WFP price data for this crop" height={200} />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="pb-2 pr-4 font-medium text-muted-foreground">Commodity</th>
                        <th className="pb-2 pr-4 font-medium text-muted-foreground text-right">Price</th>
                        <th className="pb-2 font-medium text-muted-foreground text-right">30d</th>
                      </tr>
                    </thead>
                    <tbody>
                      {matchedPrices.map(p => (
                        <tr key={p.commodity_name} className="border-b last:border-0 hover:bg-muted/50">
                          <td className="py-2 pr-4 font-medium">{p.commodity_name}</td>
                          <td className="py-2 pr-4 text-right font-mono">
                            {p.latest_price.toFixed(2)} {p.currency}
                            {p.unit && <span className="text-xs text-gray-400 ml-1">/{p.unit}</span>}
                          </td>
                          <td className={`py-2 text-right font-medium ${p.price_change_pct == null ? "text-gray-400" : p.price_change_pct > 0 ? "text-red-600" : p.price_change_pct < 0 ? "text-green-600" : "text-gray-500"}`}>
                            {p.price_change_pct == null ? "—" : `${p.price_change_pct > 0 ? "+" : ""}${p.price_change_pct.toFixed(1)}%`}
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
      </div>

      {/* ── TRADE ──────────────────────────────────────────────────────────────── */}
      <div className="space-y-6">
        <Section title="Trade" description="Import and export volumes — rising imports signal a domestic supply gap" />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Import vs Export Volume</CardTitle>
            <CardDescription>Tonnes — FAO Trade</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingCrop ? <Skeleton className="h-56 w-full" /> : tradeTrend.length === 0 ? (
              <Empty message="No data — sync FAO Trade" height={200} />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={tradeTrend} margin={{ top: 4, right: 16, left: -16, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={v => fmtNum(v)} />
                  <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number, n: string) => [`${fmtNum(v)} t`, n]} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="imports" name="Imports" fill="#2563eb" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="exports" name="Exports" fill="#16a34a" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
