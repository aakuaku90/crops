import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { PriceSummary } from "@/lib/api";

interface StatCardsProps {
  summaries: PriceSummary[];
}

export function StatCards({ summaries }: StatCardsProps) {
  const top = summaries.slice(0, 6);

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      {top.map((item) => {
        const change = item.price_change_pct;
        const isUp = change !== null && change > 0;
        const isDown = change !== null && change < 0;

        return (
          <Card key={item.commodity_name} className="relative overflow-hidden">
            <CardHeader className="pb-2 p-4">
              <CardTitle className="text-xs font-medium text-muted-foreground truncate">
                {item.commodity_name}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="text-2xl font-bold">
                {item.currency} {Number(item.latest_price).toFixed(2)}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                per {item.unit || "unit"}
              </div>
              <div className="flex items-center gap-1 mt-2">
                {isUp && (
                  <Badge variant="danger" className="text-xs px-1.5 py-0.5">
                    <TrendingUp className="w-3 h-3 mr-1" />
                    +{change?.toFixed(1)}%
                  </Badge>
                )}
                {isDown && (
                  <Badge variant="success" className="text-xs px-1.5 py-0.5">
                    <TrendingDown className="w-3 h-3 mr-1" />
                    {change?.toFixed(1)}%
                  </Badge>
                )}
                {!isUp && !isDown && (
                  <Badge variant="secondary" className="text-xs px-1.5 py-0.5">
                    <Minus className="w-3 h-3 mr-1" />
                    Stable
                  </Badge>
                )}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {item.latest_date}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
