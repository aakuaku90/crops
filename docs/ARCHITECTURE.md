# Architecture

## System diagram

```mermaid
flowchart LR
    subgraph External["External data sources"]
        WFP[WFP HDEX<br/>CSV via CKAN]
        FAO[FAOSTAT<br/>13 domains via faostat pkg]
        GSS[GSS<br/>CSV upload]
        MOFA[MoFA<br/>static CSV]
        NASA[NASA POWER + MODIS<br/>via /mapping pipeline]
        ANTH[Anthropic API<br/>Claude Sonnet 4.5 + web_search]
    end

    subgraph Backend["FastAPI :8000"]
        SYNC[Sync endpoints<br/>SSE-streamed]
        SVC[services/<br/>ingest + ML]
        ROUT[api/v1/<br/>13 query routers]
        CHAT[/chat router<br/>SSE stream/]
    end

    PG[(PostgreSQL 16<br/>28 tables)]

    subgraph ML["ML pipelines"]
        TAB[TabPFN<br/>CSV-driven]
        LGB[LightGBM<br/>trains in-process]
        ROLL[Rolling mean<br/>baseline]
        PROPH[Prophet<br/>+CPI regressor]
    end

    subgraph Frontend["Next.js :3000"]
        PAGES[~20 route pages]
        COMP[Shared components<br/>charts, map, ChatPanel]
        API[lib/api.ts<br/>fetch client]
    end

    USER[Browser]

    WFP --> SYNC
    FAO --> SYNC
    GSS --> SYNC
    MOFA --> SYNC
    NASA --> SYNC
    SYNC --> SVC --> PG
    SVC --> ML
    ML --> PG
    PG --> ROUT
    ROUT --> API
    API --> COMP --> PAGES --> USER
    USER -. types .-> CHAT
    CHAT --> ANTH
    ANTH --> CHAT --> USER
```

The defining shape: **all data lives in Postgres**. Every external feed is *pulled* by an explicit sync endpoint, normalized in a service module, and written via asyncpg upsert. Every chart on the frontend is one or two REST calls into the same DB. There is no edge cache, no message queue, no async worker — just sync HTTP and a connection pool.

## Request lifecycle

### Read path (a chart loading on the dashboard)

```mermaid
sequenceDiagram
    participant Browser
    participant Next as Next.js (page.tsx)
    participant API as FastAPI (/api/v1/*)
    participant Pool as asyncpg pool
    participant PG as Postgres

    Browser->>Next: GET /dashboard
    Next-->>Browser: HTML + JS bundle
    Browser->>Next: hydrate; useEffect → fetch(/api/v1/prices/timeseries?...)
    Next->>API: forward (or direct, when NEXT_PUBLIC_API_URL is set)
    API->>Pool: acquire conn
    Pool->>PG: SELECT ... FROM food_prices
    PG-->>Pool: rows
    Pool-->>API: rows
    API-->>Browser: JSON
    Browser->>Browser: Recharts renders
```

Latency budget: a single SELECT against a properly-indexed table (`food_prices` has indices on `date`, `commodity`, `market`, `region`) is sub-10 ms; the full round-trip from click to first render is ~80–150 ms in dev.

### Write path (sync button)

```mermaid
sequenceDiagram
    participant Browser
    participant API as POST /api/v1/sync/*
    participant SVC as services/*_service.py
    participant EXT as External source
    participant PG as Postgres

    Browser->>API: POST + open SSE stream
    API->>SVC: invoke sync_*(progress_cb)
    SVC->>EXT: fetch CSV / call faostat / read static file
    EXT-->>SVC: data
    loop per chunk
        SVC->>PG: INSERT ... ON CONFLICT DO UPDATE
        SVC-->>API: progress event {stage, pct, message}
        API-->>Browser: data: {…}\n\n
    end
    SVC-->>API: done
    API-->>Browser: data: {stage:"done"}\n\n
```

Sync endpoints return a `StreamingResponse` of SSE frames so the frontend's `SyncButton` can show live progress instead of a 90-second spinner. Every ingestion path uses the same upsert pattern, so re-running a sync is idempotent.

### Chat path

```mermaid
sequenceDiagram
    participant Browser
    participant Chat as POST /api/v1/chat
    participant Anthropic
    Browser->>Chat: {crop, region?, messages, web_search:true}
    Chat->>Anthropic: messages.stream(model=claude-sonnet-4-5,<br/>tools=[web_search_20250305])
    loop each delta
        Anthropic-->>Chat: text delta
        Chat-->>Browser: data: {type:"text",text}\n\n
    end
    Anthropic-->>Chat: done
    Chat-->>Browser: data: {type:"done"}\n\n
```

System-prompt context is injected server-side: the crop name (and optional region) become part of the system message so the assistant knows what scope the user is looking at.

## Data lineage

```mermaid
flowchart TD
    classDef raw fill:#fef3c7,stroke:#d97706
    classDef derived fill:#dbeafe,stroke:#2563eb
    classDef ml fill:#fce7f3,stroke:#db2777

    WFP_CSV[HDEX CSV]:::raw --> food_prices[(food_prices)]:::raw
    FAOSTAT[FAOSTAT API]:::raw --> fao_cpi[(fao_cpi)]:::raw
    FAOSTAT --> fao_pp[(fao_producer_prices)]:::raw
    FAOSTAT --> fao_fb[(fao_food_balances)]:::raw
    FAOSTAT --> fao_qc[(fao_crop_production)]:::raw
    FAOSTAT --> fao_pop[(fao_population)]:::raw
    FAOSTAT --> fao_other[(8 other FAO tables)]:::raw
    GSS_CSV[GSS CSV]:::raw --> gss_cp[(gss_crop_production)]:::raw
    MOFA_CSV[MoFA CSV]:::raw --> mofa_n[(mofa_national)]:::raw
    MOFA_CSV --> mofa_r[(mofa_maize_regional)]:::raw
    NASA_PIPE[mapping/ pipeline]:::raw --> climate_m[(climate_features_monthly)]:::raw
    climate_m --> climate_a[(climate_features_annual)]:::derived

    climate_a --> LGB[LightGBM]:::ml
    mofa_r --> LGB
    LGB --> mp_lgb[(maize_predictions_lightgbm)]:::ml

    mofa_r --> ROLL[5-yr rolling mean]:::ml
    ROLL --> mp_roll[(maize_predictions_rolling_mean)]:::ml

    TabPFN_CSV[TabPFN CSV<br/>computed offline]:::raw --> mp_tab[(maize_predictions)]:::ml

    food_prices --> PROPH[Prophet]:::ml
    fao_cpi --> PROPH
    PROPH --> mpf[(maize_price_forecast)]:::ml
    PROPH --> mpfm[(maize_price_forecast_meta)]:::ml

    mp_tab --> EVAL[evaluation_service]:::derived
    mp_lgb --> EVAL
    mp_roll --> EVAL
    EVAL -->|computed on-read| client[/evaluation page/]:::derived
```

A few things worth noting:

- **`climate_features_annual` is derived from `_monthly`** during sync — the monthly file is pre-aggregated by the mapping pipeline, then z-scored per region/feature on ingest.
- **TabPFN is offline-trained**; the sync just bulk-loads a pre-computed CSV. LightGBM and rolling-mean train *in-process* on the sync request — they read MoFA + climate, fit, and write predictions in one transaction.
- **Evaluation is computed at read time**, not stored. `/api/v1/evaluation/*` joins the three prediction tables on `(region, year)` where `source = 'backtest'` and computes RMSE/MAE/MAPE per model.

## Deployment topology

The repo ships two run modes:

### Local dev (`npm run dev`)

```mermaid
flowchart LR
    Dev[Developer]
    Postgres[(Postgres 16<br/>Docker container)]
    BE[backend uvicorn :8000<br/>--reload, on host]
    FE[frontend next dev :3000<br/>on host]
    Dev --> FE --> BE --> Postgres
```

`concurrently` runs uvicorn + Next dev with prefixed log streams. Postgres is the only thing in Docker; backend + frontend run on the host so hot-reload works against your local Python and node.

### Containerized (`docker compose up`)

```mermaid
flowchart LR
    Postgres[(Postgres 16<br/>:5432)]
    BE[backend :8001]
    FE[frontend :3000]
    BE --> Postgres
    FE -.NEXT_PUBLIC_API_URL.-> BE
```

All three services in containers; backend on 8001 (note: different port from local dev), volumes mount source for hot reload.

## Key design decisions

| Decision | Rationale |
|---|---|
| **Single Postgres for all data** | Eliminates the "which store has the truth?" problem. Every analytical query is one DB. |
| **All ingestion via explicit sync endpoints** | No background workers means no celery/redis/cron. Every sync is reproducible with `curl`. The cost: refreshes are manual, and we can't claim "live" on a chart older than the last button-press. |
| **asyncpg + raw SQL, not an ORM in the backend** | Most queries here are wide aggregations over a single table. ORMs add ceremony without value. Drizzle is wired *in the frontend* for type generation only — actual queries go through FastAPI. |
| **SSE for sync progress** | Sync runs (especially Prophet across 17 markets) take minutes. SSE gives the user a progress bar instead of a spinner. Native `fetch` + `ReadableStream`, no client lib. |
| **Three yield models in parallel** | Each has different inductive biases (TabPFN: tabular pretraining; LightGBM: gradient boosting on engineered climate features; rolling-mean: naive baseline). The evaluation page compares them honestly on backtest holdouts. |
| **Claude over building a domain model** | The chat panel is for free-form questions that don't fit a chart. Web search keeps it grounded; system prompt scopes to the current crop/region. |
| **Mermaid diagrams in-repo** | Renders on GitHub, version-controlled, readable as plain text in PRs. No Figma round-trip required. |

## What this architecture is bad at

For honest accounting:

- **Live data**. Nothing is "current" past the last sync. WFP CSV stops at 2023-07; that's not a frontend bug, that's the upstream feed.
- **Concurrent writes**. The sync endpoints assume one user is pressing one button at a time; nothing prevents two simultaneous Prophet runs from racing on `maize_price_forecast`.
- **Horizontal scale**. The model training runs in the API process. A real production deployment would extract LightGBM/Prophet into worker jobs (Celery, RQ, or cloud functions).
- **Auth / multi-tenant**. There isn't any. CORS allows localhost; assume single-user.

These are all fine for the current scope (analytical tool, manual operation, single-machine deploy) and clearly cheap to fix when they need fixing.
