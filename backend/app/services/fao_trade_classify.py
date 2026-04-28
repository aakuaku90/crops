"""
Classify FAOSTAT TCL (Trade — Crops & Livestock) items as raw commodity or
processed derivative.

Why this matters: when comparing import / export figures against domestic
production data, mixing raw commodities (e.g. "Cocoa beans", "Maize", "Rice,
paddy") with their processed derivatives (e.g. "Cocoa, butter", "Maize flour",
"Rice, milled") double-counts the underlying crop and inflates trade volumes
relative to production. Splitting them lets the dashboard compare like with
like.

Strategy:
  1. Apply a list of *processed-derivative keywords* against the item name.
     If any match, classify as processed. This catches the vast majority of
     FAOSTAT TCL processed items (oil, flour, meal, cake, paste, etc.).
  2. Otherwise classify as raw.

This is intentionally keyword-driven (not item_code-driven) because:
  - FAOSTAT item_codes drift across releases.
  - The processed indicators are well-bounded and stable English terms.
  - Items not yet ingested still classify correctly without a code-list update.
"""

from __future__ import annotations

# Keywords that — when present anywhere in the item name (case-insensitive) —
# mark it as a processed derivative. Order doesn't matter; first match wins.
PROCESSED_KEYWORDS: tuple[str, ...] = (
    "oil",
    "flour",
    "meal",
    "cake",
    "paste",
    "powder",
    "butter",
    "milled",
    "polished",
    "husked",
    "refined",
    "processed",
    "prepared",
    "preparation",
    "preparations",
    "products",
    "by-product",
    "byproduct",
    "extract",
    "syrup",
    "sugar refined",
    "molasses",
    "juice",
    "jam",
    "marmalade",
    "puree",
    "sauce",
    "ketchup",
    "concentrate",
    "frozen",
    "dried",  # e.g. "Cassava, dried" (preserved/processed form)
    "shelled",
    "hulled",
    "roasted",
    "fermented",
    "chocolate",
    "cocoa products",
    "wine",
    "beer",
    "spirits",
    "beverage",
    "beverages",
    "fibre",  # processed agricultural fibre
    "tow",
    "yarn",
    "bran",
    "germ",
    "starch",
    "gluten",
    "lard",
    "tallow",
    "hide",
    "skin",
    "wool",
    "hair",
)

# Explicit overrides for items where keyword matching would misclassify.
# Maps lowercased item name -> True (raw) or False (processed).
EXPLICIT_OVERRIDES: dict[str, bool] = {
    # "Cocoa beans" contains no processed keyword but make it explicit:
    "cocoa beans": True,
    "cocoa, beans": True,
    "coffee, green": True,  # "green" = unroasted = raw
    "rice, paddy": True,    # paddy rice = unhusked, raw
    "tobacco, unmanufactured": True,
    "cotton lint": True,    # ginned but minimally processed; treat as raw input
    "cotton, lint": True,
}


def classify_trade_item(item: str | None) -> str:
    """
    Return "raw" or "processed" for a FAO trade item name.

    Empty / missing names default to "raw" (conservative — surface rather
    than hide).
    """
    if not item:
        return "raw"

    name = item.strip().lower()
    if name in EXPLICIT_OVERRIDES:
        return "raw" if EXPLICIT_OVERRIDES[name] else "processed"

    for keyword in PROCESSED_KEYWORDS:
        if keyword in name:
            return "processed"

    return "raw"


def is_raw(item: str | None) -> bool:
    return classify_trade_item(item) == "raw"
