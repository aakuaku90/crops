import MaizePredictionsView from "../_MaizePredictionsView";

export default function MaizeLightGBMPage() {
  return (
    <MaizePredictionsView
      config={{
        title: "Maize Yield (LightGBM)",
        description:
          "LightGBM gradient-boosted predictions trained on the standardized climate features (X) plus per-region lag features. Backtest is leave-one-year-out; future rows trained on the full 2000–2023 joined set, with 2026 climate carried forward from 2025.",
        syncLabel: "Train + sync",
        apiPathBase: "/api/v1/predictions-lightgbm",
      }}
    />
  );
}
