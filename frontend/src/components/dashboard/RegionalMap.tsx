"use client";

import { useEffect, useMemo, useState } from "react";
import { ComposableMap, Geographies, Geography, Marker } from "react-simple-maps";
import { geoBounds, geoCentroid } from "d3-geo";
import type { Feature } from "geojson";
import { ArrowLeft } from "lucide-react";
import { getGssCropProduction, getGssYields } from "@/lib/api";
import { palette } from "@/lib/design-tokens";

// SVG viewBox dimensions used by ComposableMap when computing the projection.
const MAP_WIDTH = 600;
const MAP_HEIGHT = 500;
const DEFAULT_CENTER: [number, number] = [-1.2, 7.95];
const DEFAULT_SCALE = 3800;

// GADM region names sometimes diverge from GSS naming (no spaces). Map both ways.
const GADM_TO_GSS: Record<string, string> = {
  WesternNorth: "Western North",
  BrongAhafo: "Brong Ahafo",
  BonoEast: "Bono East",
  GreaterAccra: "Greater Accra",
  NorthEast: "North East",
  UpperEast: "Upper East",
  UpperWest: "Upper West",
};

function gssNameForGadm(gadmName: string): string {
  return GADM_TO_GSS[gadmName] ?? gadmName;
}

type Metric = "production" | "yield";

interface RegionalMapProps {
  crop: string;
  metric: Metric;
  /**
   * If provided, the map skips its internal GSS fetch and shades regions
   * directly from this map. Use for forecast/projected layers where the
   * caller already has region → value pre-aggregated (e.g. TabPFN forecasts
   * pulled from /api/v1/predictions/maize). Region keys must match GSS
   * naming (with spaces, e.g. "Brong Ahafo").
   */
  dataOverride?: Record<string, number>;
  /**
   * Color ramp choice. "harvest" (default) is the green ramp used everywhere
   * else for reported actuals. "forecast" swaps in a dusty-blue ramp so users
   * can tell at a glance that the shading reflects model output, not a measured
   * value.
   */
  ramp?: "harvest" | "forecast";
  /**
   * Fired when the user clicks a region (or clicks the same region/back button
   * to deselect). Receives the GSS-normalized region name (e.g. "Brong Ahafo")
   * or null when the selection is cleared. Lets parents react to map taps —
   * e.g. opening a chat panel scoped to that region.
   */
  onRegionSelect?: (region: string | null) => void;
}

interface GeographyFeature {
  rsmKey: string;
  properties: { NAME_1?: string };
  geometry?: unknown;
}

export function RegionalMap({ crop, metric, dataOverride, ramp = "harvest", onRegionSelect }: RegionalMapProps) {
  const [fetchedByRegion, setFetchedByRegion] = useState<Record<string, number>>({});
  const [hovered, setHovered] = useState<{ name: string; value: number | null } | null>(null);
  const [selectedGadm, setSelectedGadm] = useState<string | null>(null);
  const [selectedFeature, setSelectedFeature] = useState<Feature | null>(null);

  // Override wins over fetched data — gives parents a way to drive shading
  // from forecast values without forking this component.
  const byRegion = dataOverride ?? fetchedByRegion;

  useEffect(() => {
    if (dataOverride) return; // Caller is feeding values; skip the GSS fetch.
    let cancelled = false;
    async function load() {
      if (metric === "yield") {
        const { data } = await getGssYields({ crop, limit: 5000 });
        const agg: Record<string, { area: number; production: number }> = {};
        for (const r of data) {
          if (!agg[r.region]) agg[r.region] = { area: 0, production: 0 };
          agg[r.region].area += r.area_ha;
          agg[r.region].production += r.production_mt;
        }
        if (cancelled) return;
        setFetchedByRegion(
          Object.fromEntries(
            Object.entries(agg)
              .filter(([, v]) => v.area > 0)
              .map(([k, v]) => [k, v.production / v.area]),
          ),
        );
      } else {
        const { data } = await getGssCropProduction({ crop, element: "Production", limit: 5000 });
        const agg: Record<string, number> = {};
        for (const r of data) {
          if (r.value != null) agg[r.region] = (agg[r.region] ?? 0) + r.value;
        }
        if (cancelled) return;
        setFetchedByRegion(agg);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [crop, metric, dataOverride]);

  // Reset selection when crop / metric changes so users aren't stuck looking
  // at one region while data underneath swaps.
  useEffect(() => {
    setSelectedGadm(null);
    setSelectedFeature(null);
  }, [crop, metric]);

  // When a region is focused, center the projection on the geographic
  // midpoint of its bounding box and scale so the region fills ~85% of the
  // SVG viewport (15% inner padding). This guarantees the region sits at
  // the center of the container regardless of its shape or absolute
  // location in the country. Fall back to wide-Ghana defaults otherwise.
  const projectionConfig = useMemo(() => {
    if (!selectedFeature) {
      return { center: DEFAULT_CENTER, scale: DEFAULT_SCALE };
    }
    const [[w, s], [e, n]] = geoBounds(selectedFeature);
    // Centroid is the visual centre of mass of the polygon — for irregular
    // shapes it lines up with the eye's "centre" better than the bbox midpoint.
    const center = geoCentroid(selectedFeature) as [number, number];

    const lonSpan = Math.max(Math.abs(e - w), 0.01);
    const latSpan = Math.max(Math.abs(n - s), 0.01);
    const padding = 0.85;
    // Mercator: x-pixels per degree ≈ scale · π/180. Pick the smaller of the
    // two axis-fits so the region fits both width and height.
    const scaleX = (MAP_WIDTH * padding) / (lonSpan * Math.PI / 180);
    const scaleY = (MAP_HEIGHT * padding) / (latSpan * Math.PI / 180);
    return { center, scale: Math.min(scaleX, scaleY) };
  }, [selectedFeature]);

  // Build a 5-bucket scale from the actual value distribution. Quantiles
  // beat a fixed scale because production varies by orders of magnitude
  // across crops (yam in Brong Ahafo dwarfs onion anywhere).
  const scale = useMemo(() => {
    const values = Object.values(byRegion).filter((v) => v > 0).sort((a, b) => a - b);
    if (values.length === 0) return null;
    const q = (p: number) => values[Math.min(values.length - 1, Math.floor(values.length * p))];
    return {
      breaks: [q(0.2), q(0.4), q(0.6), q(0.8)],
      max: values[values.length - 1],
    };
  }, [byRegion]);

  // Sequential ramps — harvest green for measured actuals, dusty blue for
  // model forecasts. Same lightness progression so the choropleth reads the
  // same way regardless of which ramp is active.
  const HARVEST_RAMP = [
    palette.harvest[100],
    palette.harvest[200],
    palette.harvest[300],
    palette.harvest[500],
    palette.harvest[700],
  ];
  const FORECAST_RAMP = [
    "#E1ECF2", // very light dusty blue
    "#B7CEDB",
    "#7DA5BB",
    "#3B6E8F", // semantic.area
    "#26506F", // deep blue
  ];
  const RAMP = ramp === "forecast" ? FORECAST_RAMP : HARVEST_RAMP;

  function colorFor(value: number | undefined): string {
    if (!value || !scale) return palette.slate[100];
    if (value <= scale.breaks[0]) return RAMP[0];
    if (value <= scale.breaks[1]) return RAMP[1];
    if (value <= scale.breaks[2]) return RAMP[2];
    if (value <= scale.breaks[3]) return RAMP[3];
    return RAMP[4];
  }

  const unit = metric === "yield" ? "t/ha" : "t";

  // Compact formatter for in-map labels (1.2M, 540K, 12.3 — units appended).
  function formatValue(v: number): string {
    if (metric === "yield") return v.toFixed(1);
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
    return v.toFixed(0);
  }

  function handleRegionClick(geo: GeographyFeature) {
    const gadm = geo.properties.NAME_1 ?? "";
    if (selectedGadm === gadm) {
      setSelectedGadm(null);
      setSelectedFeature(null);
      onRegionSelect?.(null);
    } else {
      setSelectedGadm(gadm);
      setSelectedFeature(geo as unknown as Feature);
      onRegionSelect?.(gssNameForGadm(gadm));
    }
  }

  return (
    <div className="relative w-full h-full">
      <ComposableMap
        projection="geoMercator"
        projectionConfig={projectionConfig}
        width={MAP_WIDTH}
        height={MAP_HEIGHT}
        // Use the cropped viewBox only when showing the full country (it
        // tightens the framing around Ghana). When a region is fitted, use
        // the full 0 0 W H viewBox so the projection's translate of [W/2,
        // H/2] lands the region exactly in the centre of the displayed area.
        viewBox={selectedFeature ? `0 0 ${MAP_WIDTH} ${MAP_HEIGHT}` : "60 30 480 460"}
        style={{ width: "100%", height: "100%" }}
      >
        <Geographies geography="/ghana-regions.geojson">
          {({ geographies }: { geographies: GeographyFeature[] }) => {
            // When a region is selected, render only that one — gives the
            // "just showing that region" experience the user asked for.
            const visible = selectedGadm
              ? geographies.filter((g) => g.properties.NAME_1 === selectedGadm)
              : geographies;
            return (
              <>
                {visible.map((geo) => {
                  const gadmName = geo.properties.NAME_1 ?? "";
                  const gssName = gssNameForGadm(gadmName);
                  const value = byRegion[gssName];
                  const fill = colorFor(value);
                  return (
                    <Geography
                      key={geo.rsmKey}
                      geography={geo}
                      onMouseEnter={() => setHovered({ name: gssName, value: value ?? null })}
                      onMouseLeave={() => setHovered(null)}
                      onClick={() => handleRegionClick(geo)}
                      style={{
                        default: { fill, stroke: "#fff", strokeWidth: 0.6, outline: "none" },
                        hover:   { fill, stroke: palette.slate[800], strokeWidth: 1.2, outline: "none", cursor: "pointer" },
                        pressed: { fill, outline: "none" },
                      }}
                    />
                  );
                })}

                {/* Value labels at each region's centroid. White stroke +
                    black fill keeps them legible across the full colour
                    ramp. Skipped when value is missing/zero. */}
                {visible.map((geo) => {
                  const gadmName = geo.properties.NAME_1 ?? "";
                  const gssName = gssNameForGadm(gadmName);
                  const value = byRegion[gssName];
                  if (!value) return null;
                  const centroid = geoCentroid(geo as unknown as Feature) as [number, number];
                  // When a single region fills the canvas, the marker font
                  // would be blown up by the projection's scale; use a
                  // bigger fixed pixel size in that case.
                  const fontSize = selectedGadm ? 18 : 9;
                  return (
                    <Marker key={`label-${geo.rsmKey}`} coordinates={centroid}>
                      <text
                        textAnchor="middle"
                        dominantBaseline="central"
                        style={{
                          fontFamily: "inherit",
                          fontSize,
                          fontWeight: 600,
                          fill: palette.slate[900],
                          stroke: "#ffffff",
                          strokeWidth: fontSize / 4,
                          paintOrder: "stroke",
                          pointerEvents: "none",
                        }}
                      >
                        {formatValue(value)}
                        <tspan
                          dx={fontSize * 0.2}
                          style={{ fontSize: fontSize * 0.75, fontWeight: 500 }}
                        >
                          {unit}
                        </tspan>
                      </text>
                    </Marker>
                  );
                })}
              </>
            );
          }}
        </Geographies>
      </ComposableMap>

      {/* Back button — only when a region is focused */}
      {selectedGadm && (
        <button
          onClick={() => {
            setSelectedGadm(null);
            setSelectedFeature(null);
            onRegionSelect?.(null);
          }}
          className="absolute top-3 left-3 flex items-center gap-1.5 bg-card border border-border rounded-full px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors shadow-sm"
        >
          <ArrowLeft className="w-3 h-3" />
          All regions
        </button>
      )}

      {/* Tooltip pinned to top-right. Hover takes precedence; otherwise the
          currently-focused region stays displayed so users can read the
          value while exploring. */}
      {(() => {
        const display =
          hovered ??
          (selectedGadm
            ? {
                name: gssNameForGadm(selectedGadm),
                value: byRegion[gssNameForGadm(selectedGadm)] ?? null,
              }
            : null);
        if (!display) return null;
        return (
          <div className="absolute top-3 right-3 bg-card border border-border rounded-lg px-3 py-2 shadow-sm pointer-events-none">
            <div className="text-[11px] font-semibold text-foreground">{display.name}</div>
            <div className="text-[10px] text-muted-foreground">
              {display.value != null
                ? `${display.value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${unit}`
                : "No data"}
            </div>
          </div>
        );
      })()}

      {/* Legend */}
      {scale && (
        <div className="absolute bottom-3 right-3 bg-card border border-border rounded-lg px-3 py-2 shadow-sm">
          <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
            {metric === "yield" ? "Yield (t/ha)" : "Production (t)"}
          </div>
          <div className="flex items-center gap-1.5">
            {RAMP.map((c, i) => (
              <span key={i} className="w-5 h-2 rounded-sm" style={{ backgroundColor: c }} />
            ))}
          </div>
          <div className="flex justify-between text-[9px] text-muted-foreground mt-1">
            <span>Low</span>
            <span>High</span>
          </div>
        </div>
      )}
    </div>
  );
}
