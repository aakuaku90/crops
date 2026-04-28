# Ghana Maize Mapping

Annual 10 m maize map of Ghana from Sentinel-2 + Sentinel-1, with per-region area
estimates and confidence tiers. See the methodology document in the project root
(or the `/mapping` page in the dashboard) for the full design.

## One-time setup

1. Register your Cloud project for Earth Engine at
   <https://code.earthengine.google.com/register>.

2. Create the venv and install dependencies:

   ```bash
   cd mapping
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   ```

3. Authenticate Earth Engine (one-time browser flow):

   ```bash
   earthengine authenticate
   ```

4. Copy `.env.example` to `.env` and fill in your `GEE_PROJECT_ID` and
   `GCS_BUCKET`:

   ```bash
   cp .env.example .env
   ```

## Verify it works

```bash
jupyter lab
```

Open `notebooks/01_ard_test.ipynb` and run all cells. You should see:

- `Earth Engine initialized`
- `Sentinel-2 scenes: <several hundred>`
- `Sentinel-1 scenes: <several hundred>`
- An interactive map with an RGB Sentinel-2 composite and an NDVI overlay.

## Layout

```
mapping/
├── src/                # importable Python — keep notebooks thin
│   ├── ee_init.py      # ee.Initialize wrapper, AOI helpers
│   └── ard.py          # cloud masking, S1/S2 collections, indices
├── notebooks/          # exploration, visualization
├── data/               # gitignored — boundaries, ground truth
└── outputs/            # gitignored — exported rasters before they go to GCS
```

## Where things go later

| Phase | What lands where |
|---|---|
| 2 — Ground truth | `data/ground_truth/training_points.geojson` |
| 3 — Features | `src/feature_stack.py` (NDVI percentiles, DOY of max, SAR metrics) |
| 4 — Classification | `src/train_rf.py`, `src/predict.py`, model artifacts in `outputs/models/` |
| 5 — Validation | `src/accuracy.py`, region-level metrics CSV in `outputs/reports/` |

## What gets written back to the dashboard

When validation is done, regional area estimates and accuracy metrics get
written to a new Postgres table (`maize_map_regions`) read by the `/mapping`
page. The map raster itself goes to GCS and is served as PNG overlays per
region (or via a tile server for higher fidelity).
