import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

/**
 * Composable skeleton primitives that match the visual rhythm of the app's
 * pages. Pages compose the pieces they need (header + tiles + chart, etc.)
 * during their initial useEffect fetch. The Next.js route-level loading.tsx
 * uses `<PageSkeleton />` for navigation transitions.
 *
 * Every primitive uses the same `Skeleton` (animate-pulse + bg-muted) so the
 * pulse rhythm stays consistent across an entire page.
 */

/** Page heading: eyebrow + h1 + descriptive paragraph + bottom border. */
export function HeaderSkeleton() {
  return (
    <div className="pb-4 border-b border-border space-y-2">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-7 w-64" />
      <Skeleton className="h-4 w-96 max-w-full" />
    </div>
  );
}

/** Toolbar row: a few small pill-shaped controls. */
export function ToolbarSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-8 w-24 rounded-full" />
      ))}
    </div>
  );
}

/** KPI tile grid — defaults to 3 tiles in a row. */
export function TileGridSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className={`grid grid-cols-1 sm:grid-cols-${Math.min(count, 4)} gap-3`}>
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i} className="p-4 space-y-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-3 w-40 max-w-full" />
        </Card>
      ))}
    </div>
  );
}

/** A card with title + chart area. Chart is a single tall rectangle. */
export function ChartSkeleton({ height = 280 }: { height?: number }) {
  return (
    <Card className="p-5 space-y-3">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-16" />
      </div>
      <Skeleton className="w-full rounded-lg" style={{ height }} />
    </Card>
  );
}

/** Tabular block — rows of equal-height bars. */
export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <Card className="p-5 space-y-3">
      <Skeleton className="h-4 w-32" />
      <div className="space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    </Card>
  );
}

/** Choropleth map placeholder — a tall card with a single shimmer rectangle. */
export function MapSkeleton({ height = 600 }: { height?: number }) {
  return (
    <Card className="overflow-hidden p-0">
      <Skeleton className="w-full rounded-none" style={{ height }} />
    </Card>
  );
}

/** Default page-level skeleton: header + toolbar + main content + tiles. Used
 *  by the route-level loading.tsx and as a fallback in pages that don't ship
 *  a custom skeleton layout. */
export function PageSkeleton() {
  return (
    <div className="space-y-5 animate-fade-in">
      <HeaderSkeleton />
      <ToolbarSkeleton />
      <ChartSkeleton height={320} />
      <TileGridSkeleton />
    </div>
  );
}
