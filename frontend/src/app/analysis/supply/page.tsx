"use client";

import { useEffect, useState } from "react";
import {
  LineChart, Line,
  BarChart, Bar,
  AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getFaoCropProduction,
  getFaoFoodBalances,
  getFaoLandUse,
  getFaoFertilizer,
  getGssCropProduction,
  getGssYields,
  type FaoCropProduction,
  type FaoFoodBalance,
  type FaoLandUse,
  type FaoFertilizer,
  type GssCropProduction,
  type GssYieldRow,
} from "@/lib/api";
import { CHART_COLORS, CHART_GRID_STROKE, semantic } from "@/lib/design-tokens";
import { fmtNum, Empty, useCropSelection, CropSelect, PageHeader } from "../_shared";

const BALANCE_KEYS = ["Production", "Import quantity", "Export quantity", "Food", "Losses"];
const LAND_USE_ITEMS = ["Cropland", "Agricultural land", "Arable land"];

export default function SupplyPage() {
  const { crops, crop, setCrop } = useCropSelection();

  const [cropProduction, setCropProduction] = useState<FaoCropProduction[]>([]);
  const [foodBalances, setFoodBalances] = useState<FaoFoodBalance[]>([]);
  const [gssProd, setGssProd] = useState<GssCropProduction[]>([]);
  const [gssYields, setGssYields] = useState<GssYieldRow[]>([]);
  const [landUse, setLandUse] = useState<FaoLandUse[]>([]);
  const [fertilizer, setFertilizer] = useState<FaoFertilizer[]>([]);
  const [loadingCrop, setLoadingCrop] = useState(true);
  const [loadingStatic, setLoadingStatic] = useState(true);

  useEffect(() => {
    Promise.all([
      getFaoLandUse("", "Area", 200, 0),
      getFaoFertilizer(undefined, "Agricultural Use", 200, 0),
    ]).then(([lu, fert]) => {
      setLandUse(lu.data);
      setFertilizer(fert.data);
      setLoadingStatic(false);
    });
  }, []);

  useEffect(() => {
    if (!crop) return;
    setLoadingCrop(true);
    Promise.all([
      getFaoCropProduction(crop, undefined, 500, 0),
      getFaoFoodBalances(crop, undefined, 500, 0),
      getGssCropProduction({ crop, element: "Production", limit: 500 }),
      getGssYields({ crop, limit: 2000 }),
    ]).then(([prod, bal, gss, gssY]) => {
      setCropProduction(prod.data);
      setFoodBalances(bal.data);
      setGssProd(gss.data);
      setGssYields(gssY.data);
      setLoadingCrop(false);
    });
  }, [crop]);

  // Production / Area trend (FAO)
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

  // Regional production sum (GSS)
  const regionalProd = (() => {
    const byRegion: Record<string, number> = {};
    for (const d of gssProd) {
      if (d.value != null) byRegion[d.region] = (byRegion[d.region] ?? 0) + d.value;
    }
    return Object.entries(byRegion)
      .sort(([, a], [, b]) => b - a)
      .map(([region, value]) => ({ region, value }));
  })();

  // Regional yield = Σ production / Σ area (more accurate than averaging
  // per-district yields).
  const regionalYields = (() => {
    const byRegion: Record<string, { area: number; production: number }> = {};
    for (const r of gssYields) {
      if (!byRegion[r.region]) byRegion[r.region] = { area: 0, production: 0 };
      byRegion[r.region].area += r.area_ha;
      byRegion[r.region].production += r.production_mt;
    }
    return Object.entries(byRegion)
      .filter(([, v]) => v.area > 0)
      .map(([region, v]) => ({ region, yield: v.production / v.area }))
      .sort((a, b) => a.yield - b.yield);
  })();

  // Food Balance (FAO)
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

  // Land use (national, static)
  const landUseChartData = (() => {
    const byYear: Record<number, Record<string, number>> = {};
    for (const d of landUse) {
      if (!LAND_USE_ITEMS.includes(d.item)) continue;
      if (!byYear[d.year]) byYear[d.year] = {};
      byYear[d.year][d.item] = d.value;
    }
    return Object.entries(byYear)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([year, vals]) => ({ year: Number(year), ...vals }));
  })();

  // Fertilizer use (N/P/K, national, static)
  const fertChartData = (() => {
    const byYear: Record<number, Record<string, number>> = {};
    for (const d of fertilizer) {
      if (!byYear[d.year]) byYear[d.year] = {};
      const shortName = d.item.includes("nitrogen") ? "Nitrogen (N)"
        : d.item.includes("phosphate") ? "Phosphate (P₂O₅)"
        : d.item.includes("potash") ? "Potash (K₂O)"
        : d.item;
      byYear[d.year][shortName] = d.value;
    }
    return Object.entries(byYear)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([year, vals]) => ({ year: Number(year), ...vals }));
  })();

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Supply"
        description="Production volume, area harvested, regional breakdown, food balance, and inputs (land + fertilizer)."
        right={<CropSelect crops={crops} crop={crop} onChange={setCrop} />}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Production Trend</CardTitle>
            <CardDescription>Volume (tonnes) and area harvested (ha). FAO data.</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingCrop ? <Skeleton className="h-56 w-full" /> : productionTrend.length === 0 ? (
              <Empty message="No data. Sync FAO Crop Production." />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={productionTrend} margin={{ top: 4, right: 20, left: -16, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                  <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="prod" tick={{ fontSize: 10 }} tickFormatter={(v) => fmtNum(v)} />
                  <YAxis yAxisId="area" orientation="right" tick={{ fontSize: 10 }} tickFormatter={(v) => fmtNum(v)} />
                  <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number, n: string) => [`${fmtNum(v)} ${n.includes("area") ? "ha" : "t"}`, n]} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line yAxisId="prod" type="monotone" dataKey="production" name="Production (t)" stroke={semantic.production} dot={false} strokeWidth={2} />
                  <Line yAxisId="area" type="monotone" dataKey="area" name="Area harvested (ha)" stroke={semantic.area} dot={false} strokeWidth={2} strokeDasharray="4 2" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Regional Production</CardTitle>
            <CardDescription>Total production by region. GSS sub-national data.</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingCrop ? <Skeleton className="h-56 w-full" /> : regionalProd.length === 0 ? (
              <Empty message="No data. Upload a GSS CSV." />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={regionalProd} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => fmtNum(v)} />
                  <YAxis type="category" dataKey="region" tick={{ fontSize: 10 }} width={90} />
                  <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number) => [`${fmtNum(v)} t`, "Production"]} />
                  <Bar dataKey="value" fill={semantic.production} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Regional Yield</CardTitle>
          <CardDescription>
            Aggregated production ÷ aggregated area (t/ha). Districts with both values reported only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingCrop ? <Skeleton className="h-56 w-full" /> : regionalYields.length === 0 ? (
            <Empty message="No yield data. Upload a GSS CSV with both area and production columns." height={200} />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={regionalYields} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="yieldGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={semantic.area} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={semantic.area} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} vertical={false} />
                <XAxis dataKey="region" tick={{ fontSize: 10 }} angle={-35} textAnchor="end" interval={0} height={70} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => v.toFixed(1)} />
                <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number) => [`${v.toFixed(2)} t/ha`, "Yield"]} />
                <Area
                  type="monotone"
                  dataKey="yield"
                  stroke={semantic.area}
                  strokeWidth={2}
                  fill="url(#yieldGradient)"
                  dot={{ r: 3, fill: semantic.area, strokeWidth: 0 }}
                  activeDot={{ r: 5, strokeWidth: 2, stroke: "#fff" }}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Food Balance</CardTitle>
          <CardDescription>Domestic supply = Production + Imports − Exports − Losses (tonnes). FAO data.</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingCrop ? <Skeleton className="h-56 w-full" /> : balanceTrend.length === 0 ? (
            <Empty message="No data. Sync FAO Food Balances." height={200} />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={balanceTrend} margin={{ top: 4, right: 16, left: -16, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => fmtNum(v)} />
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Land Use</CardTitle>
            <CardDescription>Cropland, agricultural land, arable land (1000 ha). FAO data.</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingStatic ? <Skeleton className="h-56 w-full" /> : landUseChartData.length === 0 ? (
              <Empty message="No data. Sync FAO Land Use." />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={landUseChartData} margin={{ top: 4, right: 16, left: -16, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                  <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => fmtNum(v)} />
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
            <CardDescription>Agricultural use of N, P, K nutrients (tonnes). FAO data.</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingStatic ? <Skeleton className="h-56 w-full" /> : fertChartData.length === 0 ? (
              <Empty message="No data. Sync FAO Fertilizer." />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={fertChartData} margin={{ top: 4, right: 16, left: -16, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                  <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => fmtNum(v)} />
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
    </div>
  );
}
