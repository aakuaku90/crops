import MaizePredictionsView from "../_MaizePredictionsView";

export default function MaizeRollingMeanPage() {
  return (
    <MaizePredictionsView
      config={{
        title: "Maize Yield (5-yr Rolling Mean)"
        ,
        description:
          "Naïve baseline: each prediction is the region's prior 5-year mean of actual yield, area, and production. The point of this view is to set a floor. Any 'real' model worth using needs to beat this RMSE.",
        syncLabel: "Recompute baseline",
        apiPathBase: "/api/v1/predictions-rolling",
      }}
    />
  );
}
