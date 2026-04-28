# Crops

Ghana food-market analytics: WFP retail prices, FAO production/trade, GSS regional yields, MoFA actuals, NASA POWER + MODIS climate features, and several yield/price forecasting models — unified in Postgres with a Next.js dashboard and a Claude chat panel.

## Quickstart

```bash
npm install
npm run install:backend
npm run install:frontend
npm run dev
```

→ Frontend at `http://localhost:3000`, FastAPI at `http://localhost:8000` (OpenAPI at `/docs`), Postgres in Docker on `5432`.

## Documentation

Complete docs live in [`docs/`](./docs/):

- **[docs/README.md](./docs/README.md)** — overview, repo map, tech stack
- **[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)** — system diagram, request lifecycle, data lineage, deployment topology
- **[docs/DATA-SOURCES.md](./docs/DATA-SOURCES.md)** — every external feed and ingestion path
- **[docs/ML-PIPELINES.md](./docs/ML-PIPELINES.md)** — TabPFN, LightGBM, rolling-mean, Prophet
- **[docs/API.md](./docs/API.md)** — full endpoint reference
- **[docs/FRONTEND.md](./docs/FRONTEND.md)** — route map and component catalog
- **[docs/SCHEMA.md](./docs/SCHEMA.md)** — every Postgres table

The Mermaid diagrams in those files render natively on GitHub.
