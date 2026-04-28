"""
Normalization helpers for GSS sub-national data.

The MoFA SRID source ships inconsistent capitalization, parenthetical qualifiers,
and the occasional typo (e.g. "RIce", "CASSAVA", "Maize (white)"). Without
normalization the same crop appears as several distinct values, which fragments
regional aggregations.

These helpers run at ingestion time so the canonical name is what lands in the
database. A backfill UPDATE on the existing rows applies the same map.
"""

from __future__ import annotations

# Canonical name -> set of known variants (lowercased, stripped of qualifiers).
# Add to this map as new variants surface in the data.
_CROP_ALIASES: dict[str, tuple[str, ...]] = {
    "Rice": ("rice", "paddy rice", "rice (paddy)", "rice paddy", "milled rice"),
    "Maize": ("maize", "corn", "maize (white)", "white maize", "yellow maize"),
    "Cassava": ("cassava", "cassava roots", "cassava (fresh)"),
    "Yam": ("yam", "yams", "white yam"),
    "Cocoyam": ("cocoyam", "cocoyams", "taro"),
    "Plantain": ("plantain", "plantains"),
    "Sorghum": ("sorghum", "guinea corn"),
    "Millet": ("millet", "pearl millet", "finger millet"),
    "Cowpea": ("cowpea", "cowpeas", "beans (cowpea)"),
    "Groundnut": ("groundnut", "groundnuts", "peanut", "peanuts"),
    "Soybean": ("soybean", "soybeans", "soya bean", "soya beans", "soya"),
    "Tomato": ("tomato", "tomatoes"),
    "Pepper": ("pepper", "peppers", "chilli", "chilli pepper"),
    "Onion": ("onion", "onions"),
    "Okra": ("okra", "okro"),
    "Sweet Potato": ("sweet potato", "sweet potatoes", "sweetpotato"),
}


def _build_lookup(alias_map: dict[str, tuple[str, ...]]) -> dict[str, str]:
    """Flatten the alias map into variant -> canonical lookup."""
    return {variant: canonical for canonical, variants in alias_map.items() for variant in variants}


_LOOKUP: dict[str, str] = _build_lookup(_CROP_ALIASES)


def normalize_crop_name(raw: str | None) -> str:
    """
    Canonicalize a raw GSS crop string.

    Strategy:
      1. Strip whitespace and parenthetical qualifiers (e.g. "Rice (paddy)" -> "Rice").
      2. Lowercase + collapse internal whitespace for lookup.
      3. If the cleaned form matches a known alias, return its canonical name.
      4. Otherwise title-case the cleaned input — covers the "RIce" / "CASSAVA"
         / "rice" cases without needing every variant in the alias map.
    """
    if not raw:
        return ""

    cleaned = raw.strip()
    # Drop parenthetical qualifier for matching: "Rice (paddy)" -> "Rice"
    base_for_match = cleaned.split("(", 1)[0].strip()

    key_full = " ".join(cleaned.lower().split())
    key_base = " ".join(base_for_match.lower().split())

    if key_full in _LOOKUP:
        return _LOOKUP[key_full]
    if key_base in _LOOKUP:
        return _LOOKUP[key_base]

    # Fallback: title-case to fix capitalization inconsistencies like "RIce".
    return base_for_match.title() if base_for_match else cleaned.title()


def normalize_text(raw: str | None) -> str:
    """Title-case + collapse whitespace. Use for region / district names."""
    if not raw:
        return ""
    return " ".join(raw.split()).title()


def get_alias_map() -> dict[str, tuple[str, ...]]:
    """Expose the alias map (for backfill SQL generation and tests)."""
    return _CROP_ALIASES
