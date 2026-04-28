"use client";

import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import NumberFlow from "@number-flow/react";
import { Card } from "@/components/ui/card";
import { format, parseISO } from "date-fns";
import type { PriceSummary } from "@/lib/api";

interface StatCardsProps {
  summaries: PriceSummary[];
}

function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  try {
    return format(parseISO(d), "MMM yyyy");
  } catch {
    return d;
  }
}

export function StatCards({ summaries }: StatCardsProps) {
  const top = summaries.slice(0, 6);

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {top.map((item, idx) => {
        const change = item.price_change_pct;
        const isUp = change !== null && change > 0;
        const isDown = change !== null && change < 0;

        return (
          <Card
            key={item.commodity_name}
            className="group relative overflow-hidden border-border bg-card hover:border-foreground/40 hover:-translate-y-0.5 transition-all duration-200 animate-fade-in"
            style={{ animationDelay: `${idx * 60}ms` }}
          >
            {/* Top accent — solid for spike, dashed for drop, hidden for stable */}
            <div
              className={`absolute top-0 inset-x-0 h-0.5 ${
                isUp ? "bg-foreground" : isDown ? "bg-foreground/20" : "bg-transparent"
              }`}
            />

            <div className="p-4">
              {/* Header row */}
              <div className="flex items-start justify-between gap-2 mb-3 min-h-[1.25rem]">
                <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider truncate">
                  {item.commodity_name}
                </div>
              </div>

              {/* Price */}
              <div className="flex items-baseline gap-1">
                <span className="text-[10px] font-medium text-muted-foreground">
                  {item.currency}
                </span>
                <span className="text-2xl font-bold tabular-nums leading-none text-foreground">
                  <NumberFlow
                    value={Number(item.latest_price)}
                    format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }}
                  />
                </span>
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">
                per {item.unit || "unit"} · {formatDate(item.latest_date)}
              </div>

              {/* Trend pill */}
              <div className="mt-3">
                {isUp && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-foreground text-background px-2 py-0.5 text-[10px] font-semibold tabular-nums">
                    <ArrowUpRight className="w-3 h-3" />+{change?.toFixed(1)}%
                  </span>
                )}
                {isDown && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-border text-foreground px-2 py-0.5 text-[10px] font-semibold tabular-nums">
                    <ArrowDownRight className="w-3 h-3" />
                    {change?.toFixed(1)}%
                  </span>
                )}
                {!isUp && !isDown && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted text-muted-foreground px-2 py-0.5 text-[10px] font-medium">
                    <Minus className="w-3 h-3" />
                    Stable
                  </span>
                )}
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
