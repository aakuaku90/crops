"""Sentinel-2 and Sentinel-1 ARD generation for Ghana.

Functions here produce cloud-masked, harmonised composites and SAR temporal
metrics — the inputs to the per-season feature stack in feature_stack.py
(Phase 3 of the methodology).
"""
import ee


# Sentinel-2 SCL classes to drop: cloud shadow, medium-prob cloud, high-prob cloud, cirrus, snow
_SCL_BAD = [3, 8, 9, 10, 11]


def mask_s2_clouds(img: ee.Image) -> ee.Image:
    """Mask out clouds using the Sentinel-2 Scene Classification Layer."""
    scl = img.select("SCL")
    mask = scl.remap(_SCL_BAD, [0] * len(_SCL_BAD), 1)
    return img.updateMask(mask)


def s2_collection(aoi: ee.FeatureCollection, start: str, end: str, max_cloud_pct: int = 60) -> ee.ImageCollection:
    """Return cloud-masked Sentinel-2 L2A collection over AOI for a season window.

    Args:
        aoi: FeatureCollection defining the area of interest.
        start, end: ISO date strings, e.g. "2024-04-01" / "2024-07-31".
        max_cloud_pct: drop scenes with more than this percent cloud cover.
    """
    return (
        ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
        .filterBounds(aoi)
        .filterDate(start, end)
        .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", max_cloud_pct))
        .map(mask_s2_clouds)
    )


def add_s2_indices(img: ee.Image) -> ee.Image:
    """Add NDVI, NDWI, SWSW, NBR bands."""
    ndvi = img.normalizedDifference(["B8", "B4"]).rename("NDVI")
    ndwi = img.normalizedDifference(["B3", "B8"]).rename("NDWI")
    swsw = img.normalizedDifference(["B11", "B12"]).rename("SWSW")
    nbr = img.normalizedDifference(["B8", "B12"]).rename("NBR")
    return img.addBands([ndvi, ndwi, swsw, nbr])


def s1_collection(
    aoi: ee.FeatureCollection,
    start: str,
    end: str,
    orbit: str = "ASCENDING",
) -> ee.ImageCollection:
    """Return Sentinel-1 GRD IW VV+VH backscatter over AOI for a single orbit pass.

    Single-orbit filtering avoids geometric artifacts when mosaicking. Default is
    ASCENDING because Ghana's S1 coverage is exclusively ascending in recent years
    (verified empirically: 137 ascending vs 0 descending over the 2024 major season).
    """
    return (
        ee.ImageCollection("COPERNICUS/S1_GRD")
        .filterBounds(aoi)
        .filterDate(start, end)
        .filter(ee.Filter.eq("instrumentMode", "IW"))
        .filter(ee.Filter.eq("orbitProperties_pass", orbit))
        .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VV"))
        .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VH"))
        .select(["VV", "VH"])
    )
