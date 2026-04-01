import asyncio
from app.core.config import get_settings


def _hdex_fetch_sync() -> list[dict]:
    """
    Synchronous HDX fetch using the official hdx-python-api library.
    Run via asyncio.to_thread to avoid blocking the event loop.
    """
    import csv
    import tempfile
    from hdx.api.configuration import Configuration
    from hdx.data.dataset import Dataset

    settings = get_settings()

    try:
        Configuration.create(
            hdx_site="prod",
            user_agent="CropsGhanaDashboard",
            hdx_read_only=True,
            hdx_key=settings.hdex_api_token or None,
        )
    except Exception:
        # Configuration already created — reuse it
        pass

    try:
        dataset = Dataset.read_from_hdx("wfp-food-prices-for-ghana")
        resources = dataset.get_resources()

        for resource in resources:
            if "food prices" in resource.get("name", "").lower():
                with tempfile.TemporaryDirectory() as tmpdir:
                    _, path = resource.download(folder=tmpdir)
                    with open(path, newline="", encoding="utf-8") as f:
                        return list(csv.DictReader(f))

        return []
    except Exception as e:
        print(f"HDX fetch error: {e}")
        return []


async def fetch_hdex_csv_data() -> list[dict]:
    """Fetch Ghana food prices from HDEX using the official hdx-python-api."""
    return await asyncio.to_thread(_hdex_fetch_sync)
