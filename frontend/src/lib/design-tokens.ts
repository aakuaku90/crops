/**
 * Ghana Food Prices — Design Tokens
 *
 * Single source of truth for the app palette. The base UI colors live as HSL
 * CSS variables in `app/globals.css` so Tailwind utilities (bg-primary,
 * text-foreground, etc.) automatically pick up light/dark themes.
 *
 * The exports below are for places that can't use Tailwind classes — most
 * notably Recharts series fills/strokes and any inline SVG color props.
 *
 * Palette story: harvest green primary, warm grain amber accent, terracotta
 * for spikes/alerts, sage for stable/down, slate for chrome. Warm-tinted
 * neutrals so the dashboard feels grounded rather than corporate-SaaS.
 */

export const palette = {
  // Brand
  harvest: {
    50: "#EFF7F0",
    100: "#D6EBD9",
    200: "#AED6B5",
    300: "#82BD8C",
    400: "#56A064",
    500: "#2F7D3B", // primary
    600: "#266832",
    700: "#1E5328",
    800: "#163E1E",
    900: "#0E2914",
  },
  // Accent — warm grain / amber
  grain: {
    50: "#FCF6E9",
    100: "#F8EBC9",
    200: "#F1D693",
    300: "#EBC15C",
    400: "#E8A33D", // accent
    500: "#C9852A",
    600: "#A06820",
    700: "#774C17",
    800: "#4E310E",
    900: "#2A1A07",
  },
  // Semantic — terracotta (spike/alert)
  terracotta: {
    50: "#FBEFEC",
    100: "#F4D5CC",
    200: "#E8A99A",
    300: "#D87C67",
    400: "#C4533A", // danger
    500: "#A4402B",
    600: "#82321F",
    700: "#5F2416",
    800: "#3D170D",
    900: "#1F0B06",
  },
  // Semantic — sage (stable/down)
  sage: {
    50: "#F0F5F1",
    100: "#D9E5DC",
    200: "#B4CBBA",
    300: "#7BA888", // success
    400: "#5A8E68",
    500: "#3F7350",
    600: "#305A3F",
    700: "#23422E",
    800: "#172B1E",
    900: "#0C1610",
  },
  // Warm-tinted neutrals
  slate: {
    50: "#F7F5F2",
    100: "#EBE7E1",
    200: "#D5CFC6",
    300: "#B8B0A4",
    400: "#928879",
    500: "#6E6557",
    600: "#544C40",
    700: "#3D362C",
    800: "#26221B",
    900: "#13110D",
  },
} as const;

/**
 * Categorical chart palette — used for multi-series line/bar charts where
 * series identity matters more than semantics. Ordered for max contrast on
 * adjacent series. Pass through `getChartColor(i)` to wrap around.
 */
export const CHART_COLORS = [
  palette.harvest[500], // #2F7D3B
  palette.grain[400],   // #E8A33D
  palette.terracotta[400], // #C4533A
  "#3B6E8F",            // dusty blue — distinct from harvest/sage
  "#7C5CA3",            // muted plum — distinct from terracotta
  "#3F7350",            // deep sage
  "#A06820",            // bronze
  "#9B3A52",            // mulberry
] as const;

export const getChartColor = (i: number): string =>
  CHART_COLORS[i % CHART_COLORS.length];

/**
 * Semantic colors for price/trend indicators. Use these directly in chart
 * props where the meaning is fixed (e.g. exports = good = harvest).
 */
export const semantic = {
  up: palette.terracotta[400],   // price up = bad for consumers
  down: palette.sage[300],       // price down = good for consumers
  neutral: palette.slate[400],
  imports: "#3B6E8F",
  exports: palette.harvest[500],
  production: palette.harvest[500],
  area: "#3B6E8F",
  population: "#7C5CA3",
  cpi: palette.terracotta[400],
  supply: palette.grain[400],
  price: palette.harvest[500],
} as const;

/** Recharts grid lines — soft warm-neutral instead of pure gray. */
export const CHART_GRID_STROKE = palette.slate[100];
