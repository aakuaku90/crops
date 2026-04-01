"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { getPrices, getCommodities, getMarkets, type PriceRecord, type Commodity, type Market } from "@/lib/api";

const PAGE_SIZE = 50;

export function PriceTable() {
  const [prices, setPrices] = useState<PriceRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [commodity, setCommodity] = useState("all");
  const [market, setMarket] = useState("all");
  const [commodities, setCommodities] = useState<Commodity[]>([]);
  const [markets, setMarkets] = useState<Market[]>([]);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getCommodities().then((c) => {
      setCommodities(c.filter((item, idx, arr) => arr.findIndex((x) => x.name === item.name) === idx));
    });
    getMarkets().then((m) => {
      setMarkets(m.filter((item, idx, arr) => arr.findIndex((x) => x.name === item.name) === idx));
    });
  }, []);

  const fetchMore = useCallback(async (currentOffset: number, reset = false) => {
    if (loading) return;
    setLoading(true);
    const result = await getPrices({
      commodity: commodity !== "all" ? commodity : undefined,
      market: market !== "all" ? market : undefined,
      limit: PAGE_SIZE,
      offset: currentOffset,
    });
    setPrices((prev) => {
      if (reset) return result.data;
      const existingIds = new Set(prev.map((p) => p.id));
      return [...prev, ...result.data.filter((p) => !existingIds.has(p.id))];
    });
    setTotal(result.total);
    setHasMore(currentOffset + PAGE_SIZE < result.total);
    setLoading(false);
  }, [commodity, market, loading]);

  // Reset on filter change
  useEffect(() => {
    setPrices([]);
    setOffset(0);
    setHasMore(true);
    fetchMore(0, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commodity, market]);

  // Infinite scroll via IntersectionObserver
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading) {
          const next = offset + PAGE_SIZE;
          setOffset(next);
          fetchMore(next);
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loading, offset, fetchMore]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <CardTitle>Price Records</CardTitle>
            <CardDescription>
              {prices.length.toLocaleString()} of {total.toLocaleString()} records
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <SearchableSelect
              className="w-44"
              value={commodity}
              onValueChange={setCommodity}
              placeholder="All commodities"
              options={[
                { value: "all", label: "All commodities" },
                ...commodities.map((c) => ({ value: c.name, label: c.name })),
              ]}
            />
            <SearchableSelect
              className="w-44"
              value={market}
              onValueChange={setMarket}
              placeholder="All markets"
              options={[
                { value: "all", label: "All markets" },
                ...markets.map((m) => ({ value: m.name, label: m.name })),
              ]}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="border-b text-left">
                <th className="pb-2 pr-4 font-medium text-muted-foreground whitespace-nowrap">Date</th>
                <th className="pb-2 pr-4 font-medium text-muted-foreground whitespace-nowrap">Category</th>
                <th className="pb-2 pr-4 font-medium text-muted-foreground whitespace-nowrap">Commodity</th>
                <th className="pb-2 pr-4 font-medium text-muted-foreground whitespace-nowrap">Market</th>
                <th className="pb-2 pr-4 font-medium text-muted-foreground whitespace-nowrap">Region</th>
                <th className="pb-2 pr-4 font-medium text-muted-foreground whitespace-nowrap">District</th>
                <th className="pb-2 pr-4 font-medium text-muted-foreground whitespace-nowrap">Unit</th>
                <th className="pb-2 pr-4 font-medium text-muted-foreground whitespace-nowrap">Type</th>
                <th className="pb-2 pr-4 font-medium text-muted-foreground whitespace-nowrap">Flag</th>
                <th className="pb-2 pr-4 font-medium text-muted-foreground whitespace-nowrap">Currency</th>
                <th className="pb-2 pr-4 font-medium text-muted-foreground whitespace-nowrap text-right">Price (GHS)</th>
                <th className="pb-2 pr-4 font-medium text-muted-foreground whitespace-nowrap text-right">Price (USD)</th>
                <th className="pb-2 pr-4 font-medium text-muted-foreground whitespace-nowrap text-right">Latitude</th>
                <th className="pb-2 pr-4 font-medium text-muted-foreground whitespace-nowrap text-right">Longitude</th>
              </tr>
            </thead>
            <tbody>
              {prices.length === 0 && !loading ? (
                <tr>
                  <td colSpan={15} className="py-8 text-center text-muted-foreground">
                    No data. Use the sync button to load prices.
                  </td>
                </tr>
              ) : (
                prices.map((p) => (
                  <tr key={p.id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                    <td className="py-2 pr-4 text-xs text-muted-foreground whitespace-nowrap">{p.date}</td>
                    <td className="py-2 pr-4 text-xs text-muted-foreground capitalize">{p.category || "—"}</td>
                    <td className="py-2 pr-4 font-medium whitespace-nowrap">{p.commodity_name}</td>
                    <td className="py-2 pr-4 whitespace-nowrap">{p.market_name}</td>
                    <td className="py-2 pr-4 text-xs text-muted-foreground whitespace-nowrap">{p.region || "—"}</td>
                    <td className="py-2 pr-4 text-xs text-muted-foreground whitespace-nowrap">{p.admin2 || "—"}</td>
                    <td className="py-2 pr-4 text-xs whitespace-nowrap">{p.unit || "—"}</td>
                    <td className="py-2 pr-4">
                      <Badge variant="secondary" className="text-xs">
                        {p.price_type || "Retail"}
                      </Badge>
                    </td>
                    <td className="py-2 pr-4 text-xs text-muted-foreground">{p.price_flag || "—"}</td>
                    <td className="py-2 pr-4 text-xs text-muted-foreground">{p.currency || "—"}</td>
                    <td className="py-2 pr-4 text-right font-mono font-semibold whitespace-nowrap">
                      {Number(p.price).toFixed(2)}
                    </td>
                    <td className="py-2 pr-4 text-right font-mono text-muted-foreground whitespace-nowrap">
                      {p.usd_price != null ? Number(p.usd_price).toFixed(2) : "—"}
                    </td>
                    <td className="py-2 pr-4 text-right text-xs text-muted-foreground">
                      {p.latitude != null ? Number(p.latitude).toFixed(4) : "—"}
                    </td>
                    <td className="py-2 pr-4 text-right text-xs text-muted-foreground">
                      {p.longitude != null ? Number(p.longitude).toFixed(4) : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Infinite scroll sentinel */}
        <div ref={sentinelRef} className="py-4 text-center">
          {loading && (
            <div className="space-y-2 mt-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          )}
          {!hasMore && prices.length > 0 && (
            <p className="text-xs text-muted-foreground">All {total.toLocaleString()} records loaded</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
