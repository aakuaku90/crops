"use client";

import { useEffect, useState } from "react";
import {
  LineChart, Line,
  BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getFaoFoodBalances,
  getFaoPopulation,
  getFaoFoodSecurity,
  getFaoHealthyDietCost,
  type FaoFoodBalance,
  type FaoPopulation,
  type FaoFoodSecurity,
  type FaoHealthyDietCost,
} from "@/lib/api";
import { CHART_COLORS, CHART_GRID_STROKE, semantic } from "@/lib/design-tokens";
import { fmtNum, Empty, useCropSelection, CropSelect, PageHeader } from "../_shared";

export default function DemandPage() {
  const { crops, crop, setCrop } = useCropSelection();

  const [foodBalances, setFoodBalances] = useState<FaoFoodBalance[]>([]);
  const [population, setPopulation] = useState<FaoPopulation[]>([]);
  const [foodSecurity, setFoodSecurity] = useState<FaoFoodSecurity[]>([]);
  const [healthyDietCost, setHealthyDietCost] = useState<FaoHealthyDietCost[]>([]);
  const [loadingCrop, setLoadingCrop] = useState(true);
  const [loadingStatic, setLoadingStatic] = useState(true);

  useEffect(() => {
    Promise.all([
      getFaoPopulation("Total Population - Both sexes"),
      getFaoFoodSecurity(),
      getFaoHealthyDietCost(),
    ]).then(([pop, sec, diet]) => {
      setPopulation(pop);
      setFoodSecurity(sec);
      setHealthyDietCost(diet);
      setLoadingStatic(false);
    });
  }, []);

  useEffect(() => {
    if (!crop) return;
    setLoadingCrop(true);
    getFaoFoodBalances(crop, undefined, 500, 0).then((bal) => {
      setFoodBalances(bal.data);
      setLoadingCrop(false);
    });
  }, [crop]);

  const foodSupplyPerCapita = foodBalances
    .filter((d) => d.element === "Food supply quantity (kg/capita/yr)")
    .sort((a, b) => a.year - b.year)
    .map((d) => ({ year: d.year, value: d.value }));

  const popTrend = [...population]
    .sort((a, b) => a.year - b.year)
    .map((d) => ({ year: d.year, value: d.value }));

  const undernourishedSeries = foodSecurity
    .filter((d) => d.item?.toLowerCase().includes("prevalence of undernourishment"))
    .sort((a, b) => (a.year_start ?? 0) - (b.year_start ?? 0));

  // Group healthy diet cost by item across years
  const dietItems = [...new Set(healthyDietCost.map((d) => d.item))];
  const dietByYear: Record<number, Record<string, number>> = {};
  for (const d of healthyDietCost) {
    if (!dietByYear[d.year]) dietByYear[d.year] = {};
    dietByYear[d.year][d.item] = d.value;
  }
  const dietChartData = Object.entries(dietByYear)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([year, vals]) => ({ year: Number(year), ...vals }));

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Demand"
        description="Per-capita consumption, population growth, food security, and the cost of a healthy diet."
        right={<CropSelect crops={crops} crop={crop} onChange={setCrop} />}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Food Supply per Capita</CardTitle>
            <CardDescription>kg/capita/year. FAO Food Balances.</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingCrop ? <Skeleton className="h-56 w-full" /> : foodSupplyPerCapita.length === 0 ? (
              <Empty message="No data. Sync FAO Food Balances." />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={foodSupplyPerCapita} margin={{ top: 4, right: 16, left: -16, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                  <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 10 }} unit=" kg" />
                  <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number) => [`${v.toFixed(1)} kg/yr`, "Food supply"]} />
                  <Line type="monotone" dataKey="value" name="Food supply/capita" stroke={semantic.supply} dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Prevalence of Undernourishment</CardTitle>
            <CardDescription>% of population. FAO Food Security (national).</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingStatic ? <Skeleton className="h-56 w-full" /> : undernourishedSeries.length === 0 ? (
              <Empty message="No data. Sync FAO Food Security." />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={undernourishedSeries.map((d) => ({ label: d.year_label, value: d.value }))}
                  margin={{ top: 4, right: 16, left: -16, bottom: 50 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                  <XAxis dataKey="label" tick={{ fontSize: 9 }} angle={-35} textAnchor="end" interval={0} />
                  <YAxis tick={{ fontSize: 10 }} unit="%" />
                  <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number) => [`${v}%`, "Undernourished"]} />
                  <Bar dataKey="value" fill={semantic.up} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Population Growth</CardTitle>
            <CardDescription>Total population. FAO data.</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingStatic ? <Skeleton className="h-56 w-full" /> : popTrend.length === 0 ? (
              <Empty message="No data. Sync FAO Population." />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={popTrend} margin={{ top: 4, right: 16, left: -16, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                  <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => fmtNum(v * 1000)} />
                  <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number) => [fmtNum(v * 1000), "Population"]} />
                  <Line type="monotone" dataKey="value" name="Population" stroke={semantic.population} dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cost of a Healthy Diet</CardTitle>
            <CardDescription>USD/person/day. FAO national indicator.</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingStatic ? <Skeleton className="h-56 w-full" /> : dietChartData.length === 0 ? (
              <Empty message="No data. Sync FAO Healthy Diet Cost." />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={dietChartData} margin={{ top: 4, right: 16, left: -16, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
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
  );
}
