# Crops — Ghana Food-Market Analytics

A full-stack analytics app for Ghana's food market: WFP retail prices, FAO production/trade, GSS regional crop yields, MoFA actuals, NASA POWER + MODIS climate features, and several yield/price forecasting models — all unified under a single PostgreSQL database with a Next.js dashboard and an LLM chat panel.

## Quickstart

```bash
# 1. Install
npm install                     # root devDependencies
npm run install:backend         # backend venv + requirements
npm run install:frontend        # frontend deps

# 2. Run (Postgres in Docker, backend + frontend live-reload locally)
npm run dev
# → http://localhost:3000  (frontend)
# → http://localhost:8000  (FastAPI; OpenAPI at /docs)
# → postgres on 5432
```

`docker-compose.yml` also defines a fully-containerized stack (`docker compose up`) that runs backend on **8001** and frontend on **3000**.

Required environment variables (set in `backend/.env`):

| Var | Purpose |
|---|---|
| `POSTGRES_URL` | asyncpg DSN — e.g. `postgresql://crops:crops_pass@localhost:5432/crops_db` |
| `ANTHROPIC_API_KEY` | optional; powers the chat panel |
| `FAOSTAT_USERNAME` / `FAOSTAT_PASSWORD` | optional; required only to sync FAOSTAT bulk endpoints |

## Repo map

```
crops/
├── backend/              FastAPI service — ingestion, ML, query API
│   └── app/
│       ├── api/v1/       13 sub-routers + chat (router.py wires them)
│       ├── services/     Ingestion + ML business logic (asyncpg, pandas, prophet, lightgbm)
│       ├── db/           asyncpg pool + 28 CREATE TABLE statements
│       ├── core/         Pydantic Settings (env loader)
│       └── main.py       App factory, CORS, lifespan, manual sync endpoints
│
├── frontend/             Next.js 15 + React 19 + Recharts + Tailwind
│   └── src/
│       ├── app/          ~20 route groups (pages.tsx)
│       ├── components/   AppShell, Sidebar, ChatPanel, charts, maps
│       └── lib/          API client (fetch), design tokens
│
├── mapping/              Standalone NASA POWER + MODIS aggregation pipeline
│
├── docker-compose.yml    Postgres 16 + backend + frontend
└── docs/                 You are here.
```

## Documentation index

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — system diagram, request lifecycle, data lineage, deployment topology
- **[DATA-SOURCES.md](./DATA-SOURCES.md)** — every external feed, ingestion path, freshness, table targets
- **[ML-PIPELINES.md](./ML-PIPELINES.md)** — TabPFN, LightGBM, rolling-mean baseline, Prophet — training, backtest, output schemas
- **[API.md](./API.md)** — every `/api/v1/*` endpoint, request shape, response shape
- **[FRONTEND.md](./FRONTEND.md)** — route map, page purposes, shared component catalog
- **[SCHEMA.md](./SCHEMA.md)** — full table reference grouped by domain
- **[DEPLOY.md](./DEPLOY.md)** — Heroku deployment runbook (two-app monorepo + Postgres)

## What this app is *for*

Three concrete use cases drive the design:

1. **Market situational awareness** — "What's the current state of maize prices in Tamale, and how does it compare to the rolling 24-month band?" Drives the WFP price line charts (`/dashboard`, `/analysis/prices`).
2. **Supply-side forecasting** — "What is Ghana's projected maize production for 2026, by region, and how does it compare to projected demand?" Drives `/forecast` and `/predictions/maize`.
3. **Model evaluation** — "Which yield model (TabPFN / LightGBM / 5-yr rolling mean) generalizes best to held-out years?" Drives `/evaluation/maize`.

Everything else is supporting infrastructure: ingestion endpoints to feed Postgres, REST endpoints to query it, and a Claude-powered chat panel for free-form analytical questions grounded in web search.

## Tech stack

- **Backend** — FastAPI 0.115, asyncpg 0.29, Pydantic 2.9, Anthropic SDK ≥0.40, Prophet ≥1.1, LightGBM ≥4.3, faostat, scikit-learn, pandas
- **Frontend** — Next.js 15, React 19, TypeScript, Tailwind CSS, Recharts, react-simple-maps + d3-geo, react-markdown, Framer Motion, Drizzle ORM (config only — runtime queries go through the FastAPI layer)
- **DB** — Postgres 16
- **AI** — Claude Sonnet 4.5 via Anthropic API with the `web_search_20250305` server tool
