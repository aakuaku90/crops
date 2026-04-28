export const dynamic = "force-dynamic";

import { PriceLineChart } from "@/components/dashboard/PriceLineChart";
import { PriceTable } from "@/components/dashboard/PriceTable";
import { SyncButton } from "@/components/dashboard/SyncButton";

export default function DashboardPage() {
  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page header */}
      <div className="flex items-end justify-between flex-wrap gap-4 pb-4 border-b border-border">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            Dataset
          </div>
          <h1 className="text-2xl font-bold text-foreground leading-tight">
            WFP Food Prices
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Market-level commodity prices across Ghana, sourced from the WFP Food Prices dataset.
          </p>
        </div>
        <SyncButton />
      </div>

      <PriceLineChart />
      <PriceTable />
    </div>
  );
}
