"use client";

import { useEffect, useState } from "react";
import {
  LineChart, Line,
  BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getFaoProducerPrices,
  getPriceSummary,
  getPriceTimeseries,
  type FaoProducerPrice,
  type PriceSummary,
  type TimeseriesPoint,
} from "@/lib/api";
import { CHART_COLORS, CHART_GRID_STROKE, semantic } from "@/lib/design-tokens";
import { fmtNum, Empty, useCropSelection, CropSelect, PageHeader } from "../_shared";

export default function PricesPage() {
  const { crops, crop, setCrop } = useCropSelection();

  const [wfpTimeseries, setWfpTimeseries] = useState<TimeseriesPoint[]>([]);
  const [producerPrices, setProducerPrices] = useState<FaoProducerPrice[]>([]);
  const [priceSummary, setPriceSummary] = useState<PriceSummary[]>([]);
  const [loadingCrop, setLoadingCrop] = useState(true);
  const [loadingStatic, setLoadingStatic] = useState(true);

  useEffect(() => {
    getPriceSummary().then((px) => {
      setPriceSummary(px);
      setLoadingStatic(false);
    });
  }, []);

  useEffect(() => {
    if (!crop) return;
    setLoadingCrop(true);
    Promise.all([
      getFaoProducerPrices(crop),
      getPriceTimeseries(crop).catch(() => []),
    ]).then(([prodPx, wfpTs]) => {
      setProducerPrices(prodPx);
      setWfpTimeseries(wfpTs);
      setLoadingCrop(false);
    });
  }, [crop]);

  const wfpChartData = [...wfpTimeseries]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({ date: d.date.slice(0, 7), price: d.avg_price }));

  // Producer Prices have three flavours per item: LCU/tonne, USD/tonne, and
  // the 2014–2016=100 Index. The Index is the most consistent series across
  // commodities (1991-2025), so prefer it for the trend chart and YoY.
  const producerIndexRows = producerPrices.filter(
    (d) => d.element?.toLowerCase().includes("index"),
  );
  const producerSeriesRows = producerIndexRows.length > 0 ? producerIndexRows : producerPrices;

  const producerTrend = [...producerSeriesRows]
    .sort((a, b) => a.start_date.localeCompare(b.start_date))
    .map((d) => ({ year: new Date(d.start_date).getFullYear(), value: d.value }));

  const producerYoY = (() => {
    const sorted = [...producerSeriesRows].sort((a, b) =>
      a.start_date.localeCompare(b.start_date),
    );
    const out: { year: number; pct: number }[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      if (prev.value > 0 && curr.value != null) {
        out.push({
          year: new Date(curr.start_date).getFullYear(),
          pct: ((curr.value - prev.value) / prev.value) * 100,
        });
      }
    }
    return out;
  })();

  // Match WFP price commodities to the selected FAO crop. Use a loose
  // first-token compare so "Maize" matches "Maize (white)" etc.
  const cropKeyword = crop.toLowerCase().split(",")[0].split(" ")[0];
  const matchedPrices = priceSummary.filter(
    (p) =>
      p.commodity_name.toLowerCase().includes(cropKeyword) ||
      cropKeyword.includes(p.commodity_name.toLowerCase()),
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Prices"
        description="Retail (WFP) and farmgate (FAO) prices, year-over-year inflation, and the latest market snapshot."
        right={<CropSelect crops={crops} crop={crop} onChange={setCrop} />}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">WFP Retail Price Trend</CardTitle>
            <CardDescription>Monthly average price across Ghana markets (GHS).</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingCrop ? <Skeleton className="h-56 w-full" /> : wfpChartData.length === 0 ? (
              <Empty message="No matching WFP price data. Sync WFP Food Prices." />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={wfpChartData} margin={{ top: 4, right: 16, left: -16, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                  <XAxis dataKey="date" tick={{ fontSize: 9 }} angle={-35} textAnchor="end" interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => fmtNum(v)} />
                  <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number) => [`GHS ${v.toFixed(2)}`, "Avg price"]} />
                  <Line type="monotone" dataKey="price" name="Retail price" stroke={CHART_COLORS[3]} dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Producer Price (Farmgate)</CardTitle>
            <CardDescription>Annual average. FAO Producer Prices.</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingCrop ? <Skeleton className="h-56 w-full" /> : producerTrend.length === 0 ? (
              <Empty message="No data. Sync FAO Producer Prices." />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={producerTrend} margin={{ top: 4, right: 16, left: -16, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                  <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number) => [v.toFixed(2), "Producer price"]} />
                  <Line type="monotone" dataKey="value" name="Producer price" stroke={CHART_COLORS[4]} dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Producer Price Inflation (YoY)</CardTitle>
            <CardDescription>
              Year-over-year % change in the FAO Producer Price Index (2014–2016 = 100). Crop-specific equivalent of food CPI.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadingCrop ? <Skeleton className="h-56 w-full" /> : producerYoY.length === 0 ? (
              <Empty message="Not enough data to compute YoY. Sync FAO Producer Prices." />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={producerYoY} margin={{ top: 4, right: 16, left: -10, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                  <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
                  <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number) => [`${v >= 0 ? "+" : ""}${v.toFixed(1)}%`, "YoY change"]} />
                  <ReferenceLine y={0} stroke={semantic.neutral} />
                  <Bar dataKey="pct" radius={[3, 3, 0, 0]}>
                    {producerYoY.map((d) => (
                      <Cell key={d.year} fill={d.pct >= 0 ? semantic.up : semantic.down} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Current Market Prices</CardTitle>
            <CardDescription>Latest WFP retail prices with 30-day change.</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingStatic ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : matchedPrices.length === 0 ? (
              <Empty message="No matching WFP price data for this crop." height={200} />
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
                    {matchedPrices.map((p) => (
                      <tr key={p.commodity_name} className="border-b last:border-0 hover:bg-muted/50">
                        <td className="py-2 pr-4 font-medium">{p.commodity_name}</td>
                        <td className="py-2 pr-4 text-right font-mono">
                          {p.latest_price.toFixed(2)} {p.currency}
                          {p.unit && <span className="text-xs text-muted-foreground ml-1">/{p.unit}</span>}
                        </td>
                        <td
                          className={`py-2 text-right font-medium ${
                            p.price_change_pct == null
                              ? "text-muted-foreground"
                              : p.price_change_pct > 0
                                ? "text-foreground"
                                : "text-muted-foreground"
                          }`}
                        >
                          {p.price_change_pct == null
                            ? "—"
                            : `${p.price_change_pct > 0 ? "+" : ""}${p.price_change_pct.toFixed(1)}%`}
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
  );
}
