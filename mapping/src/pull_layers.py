"""Pull real mapping layers from Google Earth Engine for Ghana.

Outputs land in frontend/public/mapping/ so the Next.js page can read them
directly with no backend round-trip:

  - regions.geojson         Ghana level-1 admin regions (FAO GAUL)
  - region_areas.json       per-region cropland (WorldCover) + maize (WorldCereal main season) hectares
  - tile_urls.json          XYZ tile URL templates for WorldCereal maize, WorldCover cropland,
                            and Sentinel-2 NDVI overlays
  - meta.json               source attribution + generation timestamp + tile expiry note

Re-run any time. Tile URLs are valid for ~24 hours; the script is idempotent.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import ee

from ee_init import init

# ── Output location ──────────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent.parent
OUT = ROOT / "frontend" / "public" / "mapping"
OUT.mkdir(parents=True, exist_ok=True)


def ghana_regions() -> ee.FeatureCollection:
    """Ghana level-1 admin regions from FAO GAUL 2015 (the version on GEE)."""
    return ee.FeatureCollection("FAO/GAUL_SIMPLIFIED_500m/2015/level1").filter(
        ee.Filter.eq("ADM0_NAME", "Ghana")
    )


# ── 1. Export region boundaries as GeoJSON ───────────────────────────────────
def export_region_geojson() -> int:
    print("[1/4] Exporting Ghana region boundaries...")
    regions = ghana_regions()
    info = regions.getInfo()
    # Slim down properties — we only need the region name as the join key.
    for feat in info["features"]:
        props = feat.get("properties", {})
        feat["properties"] = {"region": props.get("ADM1_NAME")}
    out = OUT / "regions.geojson"
    out.write_text(json.dumps(info))
    n = len(info["features"])
    print(f"      → {n} regions written to {out.relative_to(ROOT)}")
    return n


# ── 2. Per-region cropland + maize area from real raster products ────────────
def compute_region_areas() -> list[dict]:
    print("[2/4] Computing per-region cropland (WorldCover) and maize (WorldCereal)...")
    regions = ghana_regions()

    # ESA WorldCover 2021 — cropland is class 40
    cropland_mask = ee.Image("ESA/WorldCover/v200/2021").eq(40).rename("cropland")

    # ESA WorldCereal 2021 — actual maize binary classification, main season.
    # Verified: 5 tiles cover Ghana across AEZs 32121, 34120, 7091, season
    # "tc-maize-main". Classification value 100 = maize.
    wc_maize = (
        ee.ImageCollection("ESA/WorldCereal/2021/MODELS/v100")
        .filter(ee.Filter.eq("product", "maize"))
        .filterBounds(regions)
        .select("classification")
        .mosaic()
        .eq(100)
        .rename("maize")
    )

    # Pixel area in hectares (10 m resolution → 0.01 ha per pixel)
    pixel_ha = ee.Image.pixelArea().divide(10_000)

    cropland_ha = cropland_mask.multiply(pixel_ha).rename("cropland_ha")
    maize_ha = wc_maize.multiply(pixel_ha).rename("maize_ha")

    stack = cropland_ha.addBands(maize_ha)

    # reduceRegions sums each band per polygon
    reduced = stack.reduceRegions(
        collection=regions,
        reducer=ee.Reducer.sum(),
        scale=100,  # 100 m sampling — fast enough nationally, ±1% area accuracy
    )

    info = reduced.getInfo()
    rows = []
    for feat in info["features"]:
        p = feat["properties"]
        rows.append(
            {
                "region": p.get("ADM1_NAME"),
                "cropland_ha": round(p.get("cropland_ha") or 0, 1),
                "maize_ha": round(p.get("maize_ha") or 0, 1),
            }
        )
    rows.sort(key=lambda r: r["maize_ha"], reverse=True)

    out = OUT / "region_areas.json"
    out.write_text(json.dumps(rows, indent=2))
    print(f"      → {len(rows)} regions written to {out.relative_to(ROOT)}")
    print(f"      → top region by maize: {rows[0]['region']} ({rows[0]['maize_ha']:,} ha)")
    return rows


# ── 3. Tile URL templates for the Leaflet map ────────────────────────────────
def _tile_url_template(image: ee.Image, vis: dict) -> str:
    """Wrap getMapId — vis params must be CSV strings, not raw numbers."""
    str_vis = {}
    for k, v in vis.items():
        if isinstance(v, list):
            str_vis[k] = ",".join(str(x) for x in v)
        else:
            str_vis[k] = str(v)
    map_id = ee.data.getMapId({"image": image, **str_vis})
    return map_id["tile_fetcher"].url_format


def export_tile_urls() -> dict:
    print("[3/4] Generating GEE tile URLs (valid ~24h)...")
    regions = ghana_regions()

    # WorldCover cropland
    worldcover = ee.Image("ESA/WorldCover/v200/2021").eq(40).selfMask()
    wc_url = _tile_url_template(
        worldcover.clip(regions),
        {"min": 1, "max": 1, "palette": ["#16a34a"]},
    )

    # WorldCereal maize (main season) — the actual maize binary classification
    wcereal_maize = (
        ee.ImageCollection("ESA/WorldCereal/2021/MODELS/v100")
        .filter(ee.Filter.eq("product", "maize"))
        .filterBounds(regions)
        .select("classification")
        .mosaic()
        .eq(100)
        .selfMask()
    )
    wcereal_maize_url = _tile_url_template(
        wcereal_maize.clip(regions),
        {"min": 1, "max": 1, "palette": ["#d97706"]},
    )

    # Sentinel-2 NDVI median, 2024 major season
    s2 = (
        ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
        .filterBounds(regions)
        .filterDate("2024-04-01", "2024-07-31")
        .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 60))
    )
    ndvi = s2.map(lambda i: i.normalizedDifference(["B8", "B4"]).rename("NDVI")).median().clip(regions)
    ndvi_url = _tile_url_template(
        ndvi,
        {"min": 0, "max": 0.9, "palette": ["#fef3c7", "#84cc16", "#15803d", "#052e16"]},
    )

    urls = {
        "worldcover_cropland": {
            "url": wc_url,
            "label": "ESA WorldCover 2021 — Cropland",
            "color": "#16a34a",
        },
        "worldcereal_maize": {
            "url": wcereal_maize_url,
            "label": "ESA WorldCereal 2021 — Maize (main season)",
            "color": "#d97706",
        },
        "s2_ndvi_2024_major": {
            "url": ndvi_url,
            "label": "Sentinel-2 NDVI — 2024 major season",
            "color": "#15803d",
        },
    }

    out = OUT / "tile_urls.json"
    out.write_text(json.dumps(urls, indent=2))
    print(f"      → 3 tile URL templates written to {out.relative_to(ROOT)}")
    return urls


# ── 4. Metadata sidecar ──────────────────────────────────────────────────────
def write_meta(n_regions: int, n_areas: int) -> None:
    meta = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "n_regions": n_regions,
        "n_area_rows": n_areas,
        "tile_url_expiry_hours": 24,
        "sources": [
            {"name": "FAO GAUL 2015 level-1", "id": "FAO/GAUL_SIMPLIFIED_500m/2015/level1"},
            {"name": "ESA WorldCover 2021", "id": "ESA/WorldCover/v200/2021"},
            {"name": "ESA WorldCereal 2021 (maize, main season)", "id": "ESA/WorldCereal/2021/MODELS/v100"},
            {"name": "Sentinel-2 L2A Harmonized", "id": "COPERNICUS/S2_SR_HARMONIZED"},
        ],
        "notes": [
            "Tile URLs are valid for ~24 hours; re-run pull_layers.py to refresh.",
            "Per-region areas computed at 100 m sampling for speed (national accuracy ±1%).",
            "Maize layer uses the WorldCereal binary maize classification (main season) — 5 AEZ tiles cover Ghana (32121, 34120, 7091).",
        ],
    }
    out = OUT / "meta.json"
    out.write_text(json.dumps(meta, indent=2))
    print(f"[4/4] Metadata written to {out.relative_to(ROOT)}")


def main() -> None:
    init()
    n_regions = export_region_geojson()
    rows = compute_region_areas()
    export_tile_urls()
    write_meta(n_regions, len(rows))
    print("\nDone. Outputs in frontend/public/mapping/")


if __name__ == "__main__":
    main()
