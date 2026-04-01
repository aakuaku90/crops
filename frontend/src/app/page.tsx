export const dynamic = "force-dynamic";

import { PriceLineChart } from "@/components/dashboard/PriceLineChart";
import { PriceTable } from "@/components/dashboard/PriceTable";
import { SyncButton } from "@/components/dashboard/SyncButton";

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      {/* Header row */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold text-gray-900">WFP</h2>
            <span className="text-2xl font-normal text-gray-500">(WFP Food Prices dataset)</span>
          </div>
        </div>
        <SyncButton />
      </div>

      {/* Chart */}
      <PriceLineChart />

      {/* Table */}
      <PriceTable />
    </div>
  );
}
