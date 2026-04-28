"use client";

import { useEffect, useState } from "react";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { getTrackerCrops } from "@/lib/api";

export function fmtNum(n: number, d = 0): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(d);
}

export function Empty({ message, height = 240 }: { message: string; height?: number }) {
  return (
    <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
      {message}
    </div>
  );
}

/**
 * Hook: shared crop selection across all /analysis/* pages.
 * - Loads crop list from /api/v1/gss/tracker-crops
 * - Persists selection in URL ?crop= so it survives reloads + cross-page nav
 * - Default crop "Maize" matches the rest of the app
 */
export function useCropSelection(defaultCrop = "Maize") {
  const [crops, setCrops] = useState<string[]>([]);
  const [crop, setCrop] = useState(defaultCrop);

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("crop");
    if (fromUrl) setCrop(fromUrl);
  }, []);

  useEffect(() => {
    if (!crop || typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("crop") === crop) return;
    url.searchParams.set("crop", crop);
    window.history.replaceState(null, "", url.toString());
  }, [crop]);

  useEffect(() => {
    getTrackerCrops().then(setCrops);
  }, []);

  return { crops, crop, setCrop };
}

export function CropSelect({
  crops,
  crop,
  onChange,
}: {
  crops: string[];
  crop: string;
  onChange: (v: string) => void;
}) {
  return (
    <SearchableSelect
      options={crops.map((c) => ({ value: c, label: c }))}
      value={crop}
      onValueChange={onChange}
      placeholder="Select crop"
      className="w-48"
    />
  );
}

export function PageHeader({
  title,
  description,
  right,
}: {
  title: string;
  description: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4 flex-wrap pb-4 border-b border-border">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
          Analysis
        </div>
        <h1 className="text-2xl font-bold text-foreground leading-tight">{title}</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">{description}</p>
      </div>
      {right}
    </div>
  );
}
