"""
HDEX (Humanitarian Data Exchange) WFP Ghana food prices fetcher.

Uses the public CKAN API directly instead of `hdx-python-api`. Two reasons:
  1. `hdx-python-api` 6.x ships a broken transitive import
     (`hdx.utilities.typehint` doesn't exist in the matching utilities pkg),
     making the library unusable without pinning fragile internal versions.
  2. We only need one read endpoint, so a 30-line `requests` call is simpler
     and dependency-free.

Note on freshness: the underlying CSV stops at July 2023 even though the CKAN
metadata is touched daily. WFP no longer publishes Ghana monthly retail prices.
"""

from __future__ import annotations

import asyncio
import csv
import io
import requests

CKAN_PACKAGE_URL = "https://data.humdata.org/api/3/action/package_show?id=wfp-food-prices-for-ghana"


def _resolve_csv_url() -> str | None:
    """Read package metadata and return the URL of the food-prices CSV resource."""
    resp = requests.get(CKAN_PACKAGE_URL, timeout=30)
    resp.raise_for_status()
    payload = resp.json()
    if not payload.get("success"):
        return None
    for r in payload["result"].get("resources", []):
        name = (r.get("name") or "").lower()
        fmt = (r.get("format") or "").lower()
        if fmt == "csv" and "food prices" in name:
            return r.get("url")
    return None


def _hdex_fetch_sync() -> list[dict]:
    """
    Synchronous HDEX fetch via plain CKAN API. Run via asyncio.to_thread.

    The first row after the header is a #-prefixed schema row (HXL tags) which
    we skip so it doesn't pollute downstream parsing.
    """
    url = _resolve_csv_url()
    if not url:
        print("HDEX fetch: could not resolve CSV URL from CKAN metadata")
        return []

    resp = requests.get(url, timeout=120, allow_redirects=True)
    resp.raise_for_status()

    text = resp.content.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    rows: list[dict] = []
    for row in reader:
        # Skip the HXL tag row that follows the header in WFP CSVs
        # (each value starts with "#", e.g. "#date", "#adm1+name").
        first_val = next(iter(row.values()), "") or ""
        if first_val.startswith("#"):
            continue
        rows.append(row)
    return rows


async def fetch_hdex_csv_data() -> list[dict]:
    """Fetch Ghana food prices from HDEX (CKAN public API)."""
    return await asyncio.to_thread(_hdex_fetch_sync)
