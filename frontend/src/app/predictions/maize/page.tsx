import MaizePredictionsView from "../_MaizePredictionsView";

export default function MaizeTabPFNPage() {
  return (
    <MaizePredictionsView
      config={{
        title: "Maize Yield (TabPFN)",
        description:
          "TabPFN model predictions for maize yield, area, and production per Ghana region. Backtest rows pair actuals with predictions for evaluation; future rows extend the forecast beyond the historical record.",
        syncLabel: "Sync predictions",
        apiPathBase: "/api/v1/predictions",
      }}
    />
  );
}
