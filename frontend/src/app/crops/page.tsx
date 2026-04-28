"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import {
  CropBalanceChart,
  type CropBalanceData,
} from "@/components/dashboard/CropBalanceChart";
import {
  getFaoFoodBalances,
  getFaoPopulation,
  getFaoProducerPrices,
  getTrackerCrops,
} from "@/lib/api";

/**
 * Per-crop balance details. Renders a CropBalanceChart for each of the 10
 * tracker crops (the trending one is excluded since it's already on the
 * Signals page; this list shows the other 9).
 *
 * Re-fetches the same data the Signals page does (food balances, prices,
 * population) — duplication is acceptable for a small dashboard, and avoids
 * needing a shared client-side data layer.
 */

interface PerCropPayload {
  crop: string;
  data: CropBalanceData;
  /** Latest YoY production % — used to pick the trending crop to exclude. */
  yoyPct: number;
}

export default function CropsPage() {
  const [crops, setCrops] = useState<PerCropPayload[]>([]);
  const [population, setPopulation] = useState<Record<number, number>>({});

  useEffect(() => {
    getFaoPopulation("Total Population - Both sexes").then((rows) => {
      const map: Record<number, number> = {};
      for (const r of rows) map[r.year] = r.value * 1000;
      setPopulation(map);
    });
  }, []);

  useEffect(() => {
    if (Object.keys(population).length === 0) return;
    let cancelled = false;
    async function load() {
      const tracked = await getTrackerCrops();

      const results = await Promise.all(
        tracked.map(async (crop): Promise<PerCropPayload | null> => {
          // Same per-crop history shape Signals computes — kept inline here
          // so this page is independent of the Signals page's state.
          const [balances, producer] = await Promise.all([
            getFaoFoodBalances(crop, undefined, 500, 0),
            getFaoProducerPrices(crop),
          ]);

          const cropLc = crop.toLowerCase();
          const primary = balances.data.filter(
            (r) => r.item.toLowerCase() === `${cropLc} and products`,
          );
          const filtered = primary.length > 0 ? primary : balances.data;
          const byYear: Record<number, { supply: number; demand: number; imports: number; exports: number; food: number }> = {};
          for (const r of filtered) {
            const el = (r.element ?? "").toLowerCase();
            if (!byYear[r.year]) byYear[r.year] = { supply: 0, demand: 0, imports: 0, exports: 0, food: 0 };
            if (el === "production") byYear[r.year].supply = r.value;
            if (el === "import quantity") byYear[r.year].imports = r.value;
            if (el === "export quantity") byYear[r.year].exports = r.value;
            if (el === "food") byYear[r.year].food = r.value;
            if (el === "food" || el === "losses" || el === "feed") {
              byYear[r.year].demand = (byYear[r.year].demand ?? 0) + r.value;
            }
          }
          const history = Object.entries(byYear)
            .filter(([, v]) => v.supply > 0 && v.demand > 0)
            .map(([y, v]) => ({ year: Number(y), ...v }))
            .sort((a, b) => a.year - b.year);
          if (history.length < 2) return null;

          // Producer prices: forward-fill missing years (matches Signals).
          const lcu = producer.filter((p) => /lcu\/tonne/i.test(p.element ?? ""));
          const prices: Record<number, number> = {};
          for (const r of lcu) {
            const y = new Date(r.start_date).getFullYear();
            if (r.value > 0) prices[y] = r.value;
          }
          const years = Object.keys(prices).map(Number).sort((a, b) => a - b);
          if (years.length >= 2) {
            const first = years[0];
            const last = years[years.length - 1];
            let lastPrice = prices[first];
            for (let y = first; y <= last; y++) {
              if (prices[y] != null) lastPrice = prices[y];
              else prices[y] = lastPrice;
            }
          }

          const latest = history.at(-1)!;
          const prior = history.at(-2)!;
          const yoyPct = prior.supply > 0
            ? ((latest.supply - prior.supply) / prior.supply) * 100
            : 0;

          return {
            crop,
            yoyPct,
            data: { crop, history, producerPrices: prices, population },
          };
        }),
      );
      if (!cancelled) {
        setCrops(results.filter((x): x is PerCropPayload => x !== null));
      }
    }
    load();
    return () => { cancelled = true; };
  }, [population]);

  const trendingCrop = useMemo(() => {
    return [...crops].sort((a, b) => Math.abs(b.yoyPct) - Math.abs(a.yoyPct))[0]?.crop;
  }, [crops]);

  // Show every crop except the trending one (which is on the Signals page).
  const otherCrops = crops.filter((c) => c.crop !== trendingCrop);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="pb-4 border-b border-border flex items-end justify-between flex-wrap gap-3">
        <div>
          <Link
            href="/"
            className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors mb-2"
          >
            <ArrowLeft className="w-3 h-3" />
            Back to Signals
          </Link>
          <h1 className="text-2xl font-bold text-foreground leading-tight">
            All Crops
          </h1>
          <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
            Per-crop food balance for every tracked staple. Production, domestic use, modelled demand, and trade flows side-by-side.
            {trendingCrop && ` ${trendingCrop} is featured on the Signals page.`}
          </p>
        </div>
        {trendingCrop && (
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Showing {otherCrops.length} of {crops.length} crops
          </span>
        )}
      </div>

      {crops.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">
          Loading crop balances…
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {otherCrops.map((c) => (
            <CropBalanceChart key={c.crop} data={c.data} compact />
          ))}
        </div>
      )}
    </div>
  );
}
