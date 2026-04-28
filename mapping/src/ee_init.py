"""Single source of truth for Earth Engine initialization.

Every script and notebook imports `init()` from here so the Cloud project ID
lives in one place (.env) and authentication is consistent.
"""
import os
from pathlib import Path

import ee
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")


def init() -> None:
    project = os.getenv("GEE_PROJECT_ID")
    if not project:
        raise RuntimeError(
            "GEE_PROJECT_ID is not set. Copy .env.example to .env and fill in your Cloud project ID."
        )
    ee.Initialize(project=project)


def ghana_boundary() -> ee.FeatureCollection:
    """Country-level Ghana boundary from FAO GAUL — works without uploading any assets.

    For region-level boundaries, upload GADM gadm41_GHA_1.shp as a GEE asset
    and reference it directly with ee.FeatureCollection("projects/.../assets/gadm41_GHA_1").
    """
    return ee.FeatureCollection("FAO/GAUL_SIMPLIFIED_500m/2015/level0").filter(
        ee.Filter.eq("ADM0_NAME", "Ghana")
    )
