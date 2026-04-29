import { PageSkeleton } from "@/components/dashboard/PageSkeleton";

/**
 * Next.js App Router renders this during route transitions and initial
 * navigation while the new page's chunks load. Per-route loading.tsx files
 * can override this with a layout-specific skeleton; otherwise this is the
 * universal fallback.
 */
export default function Loading() {
  return <PageSkeleton />;
}
