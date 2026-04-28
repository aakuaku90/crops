/**
 * CROPS logo mark — a leaf silhouette whose central vein rises like a trend
 * line, with branching veins doubling as ascending data ticks. Captures the
 * two halves of the app: agriculture (leaf) and price tracking (rising line).
 *
 * Continuous animation: the trend line endlessly redraws (mimicking new data
 * being plotted), and the three side veins pulse in sequence so the chart
 * looks like it's being populated with live ticks. The leaf body itself
 * gently breathes (subtle 4% scale loop) to keep the mark feeling organic.
 */
const PATH_INIT = { strokeDasharray: 1, strokeDashoffset: 1 } as const;

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      style={{ transformOrigin: "center" }}
    >
      <g className="animate-logo-breath" style={{ transformOrigin: "center", transformBox: "fill-box" } as React.CSSProperties}>
        {/* leaf body — draws once on mount */}
        <path
          d="M3.5 20.5 C3.5 11.5 11 4 20.5 3.5 C20 13 12.5 20.5 3.5 20.5 Z"
          pathLength={1}
          className="animate-draw-stroke"
          style={{ ...PATH_INIT, animationDelay: "0ms" }}
        />
        {/* main vein = rising trend line — continuously redraws */}
        <path
          d="M3.5 20.5 L20.5 3.5"
          pathLength={1}
          className="animate-draw-cycle"
          style={{ strokeDasharray: 1 }}
        />
        {/* ascending side veins / data ticks — pulse in sequence forever */}
        <path
          d="M9 15 L12.5 16.5"
          pathLength={1}
          className="animate-logo-pulse"
          style={{ animationDelay: "0ms" }}
        />
        <path
          d="M12 12 L15.5 13.5"
          pathLength={1}
          className="animate-logo-pulse"
          style={{ animationDelay: "350ms" }}
        />
        <path
          d="M15 9 L18.5 10.5"
          pathLength={1}
          className="animate-logo-pulse"
          style={{ animationDelay: "700ms" }}
        />
      </g>
    </svg>
  );
}
