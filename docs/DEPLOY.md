# Deployment — Heroku

The repo is a monorepo (`backend/` + `frontend/`) deployed as **two separate Heroku apps** sharing one Postgres database. Both use container deploys via `heroku.yml`. This doc walks through the first deploy end-to-end.

## Prerequisites

- Heroku CLI ≥ 11 logged in (`heroku auth:whoami`)
- Git repo committed (the deploy uses `git subtree push`)
- Docker Desktop running locally (for build verification before pushing — optional but recommended)
- Anthropic API key if you want the chat panel live

## Topology

```
┌──────────────┐      ┌──────────────┐       ┌─────────────────┐
│  crops-web   │ ───→ │   crops-api  │ ───→  │ Heroku Postgres │
│  (Next.js)   │      │   (FastAPI)  │       │  (mini plan)    │
└──────────────┘      └──────────────┘       └─────────────────┘
   $PORT, NEXT_PUBLIC_API_URL    $PORT, DATABASE_URL,
                                 FRONTEND_URL,
                                 ANTHROPIC_API_KEY
```

Two apps, one DB. Frontend never talks to Postgres directly — every request goes through the API. CORS on the API trusts the frontend's URL via `FRONTEND_URL`.

## Step 1 — Create the apps

```bash
# From the repo root
heroku create crops-api --stack container
heroku create crops-web --stack container
```

`--stack container` is required because we deploy via `heroku.yml` Docker manifests, not the Node/Python buildpacks.

## Step 2 — Provision Postgres on the API app

```bash
heroku addons:create heroku-postgresql:mini -a crops-api
```

`mini` is the cheapest paid tier ($5/mo). The `essential-0` (free) tier has connection limits that bite under load. After provisioning, Heroku injects `DATABASE_URL` automatically.

## Step 3 — Configure env vars

### API app (`crops-api`)

```bash
# Where does the frontend live? Backend uses this for CORS.
heroku config:set FRONTEND_URL=https://crops-web.herokuapp.com -a crops-api

# Anthropic key — chat returns 503 without it
heroku config:set ANTHROPIC_API_KEY=sk-ant-... -a crops-api

# Optional FAOSTAT credentials if you want to sync FAOSTAT bulk endpoints
heroku config:set FAOSTAT_USERNAME=... FAOSTAT_PASSWORD=... -a crops-api
```

### Web app (`crops-web`)

The frontend's API URL is **hardcoded in `frontend/heroku.yml`** under `build.config.NEXT_PUBLIC_API_URL` because Heroku does not interpolate `$VAR` references in that block — values are passed verbatim to `docker build`. To rotate the URL, edit `frontend/heroku.yml` and redeploy.

> **Build-time vs runtime**: `NEXT_PUBLIC_*` is baked into the bundle at build time. Changing it always requires a frontend redeploy, not just a config change.

## Step 4 — Add Heroku as git remotes

```bash
heroku git:remote -r heroku-api -a crops-api
heroku git:remote -r heroku-web -a crops-web
```

This adds two named remotes pointing at the two app repos. Verify with `git remote -v`.

## Step 5 — Deploy

Because `heroku.yml` lives inside `backend/` and `frontend/` (not at the repo root), use `git subtree push` to send only the relevant subdirectory to each app:

```bash
# Deploy the API
git subtree push --prefix backend heroku-api main

# Deploy the web
git subtree push --prefix frontend heroku-web main
```

> **Branch naming**: Heroku deploys from `main`. If your local branch is something else, use `<branch>:main` instead — e.g. `git subtree push --prefix backend heroku-api feature-x:main`.

The first push for each app will:

1. Build the Docker image inside Heroku's build environment
2. Run the `release` phase on the API (creates schema)
3. Spin up the web dyno

Watch the build with `heroku logs --tail -a crops-api`.

## Step 6 — Verify

```bash
# Health check on API
curl https://crops-api.herokuapp.com/health
# → {"status":"ok","service":"Ghana Food Prices API"}

# OpenAPI docs
open https://crops-api.herokuapp.com/docs

# Frontend
open https://crops-web.herokuapp.com
```

## Step 7 — Seed data

The DB is empty after first deploy. Trigger syncs in order — most have a "Sync" button on their respective frontend page, but `curl` works too:

```bash
API=https://crops-api.herokuapp.com

curl -X POST $API/api/v1/sync/hdex                  # WFP food prices CSV
curl -X POST $API/api/v1/sync/fao/cpi               # FAO CPI
curl -X POST $API/api/v1/sync/fao/producer-prices   # FAO producer prices
curl -X POST $API/api/v1/sync/fao/food-balances     # for the supply/demand chart
curl -X POST $API/api/v1/sync/fao/population        # for demand projections
curl -X POST $API/api/v1/sync/fao/crop-production
curl -X POST $API/api/v1/sync/fao/trade
# (and so on — see DATA-SOURCES.md for the full list)

# MoFA + climate (need static CSVs in the slug)
curl -X POST $API/api/v1/mofa/sync
curl -X POST $API/api/v1/climate/sync

# ML pipelines (slow — minutes)
curl -X POST $API/api/v1/predictions/maize/sync
curl -X POST $API/api/v1/predictions-lightgbm/maize/sync
curl -X POST $API/api/v1/predictions-rolling/maize/sync
curl -X POST $API/api/v1/price-forecast/maize/sync
```

## Subsequent deploys

```bash
git subtree push --prefix backend heroku-api main     # backend changes
git subtree push --prefix frontend heroku-web main    # frontend changes
```

If `git subtree push` rejects with "Updates were rejected because the tip of your current branch is behind", force-push with the splitty trick:

```bash
git push heroku-api $(git subtree split --prefix backend HEAD):main --force
git push heroku-web $(git subtree split --prefix frontend HEAD):main --force
```

## Common issues

### Backend build OOMs during pip install

Prophet pulls in cmdstanpy + numpy + pandas; the slim Python image plus those deps can exceed the build-time RAM on Standard-1X. Workarounds:

- Upgrade temporarily to `performance-m` for the build, downgrade after first successful deploy
- Or, pre-build the image locally with `docker buildx`, push to Heroku Container Registry, and skip `git subtree push` entirely (`heroku container:push web -a crops-api && heroku container:release web -a crops-api`)

### CORS errors in the browser

If the frontend logs `CORS error` against the API, double-check `FRONTEND_URL` on the API matches exactly (scheme + host, no trailing slash):

```bash
heroku config:get FRONTEND_URL -a crops-api
# → https://crops-web.herokuapp.com
```

### `NEXT_PUBLIC_API_URL` not set in the bundle

`NEXT_PUBLIC_*` is **build-time only** in Next.js. Setting it after deploy doesn't affect the running JS bundle. After changing it:

```bash
heroku config:set NEXT_PUBLIC_API_URL=... -a crops-web
git commit --allow-empty -m "trigger redeploy"
git subtree push --prefix frontend heroku-web main
```

### Sync runs hit dyno timeout

Heroku web dynos enforce a 30-second wait for the *initial* response. The SSE sync endpoints stream their first event immediately, so the connection stays open beyond 30s — that's fine. But if a sync endpoint is too slow to flush the first frame (e.g. faostat package's first network call), it'll be killed.

If this happens, run the sync as a one-off worker:

```bash
heroku run -a crops-api -- python -c "import asyncio; from app.services.fao_service import sync_fao_cpi; asyncio.run(sync_fao_cpi())"
```

That runs in a separate dyno with no request-timeout, then exits.

### Prophet sync times out

Training Prophet across 17 markets takes 3+ minutes. The same one-off pattern applies — run it as `heroku run` rather than from the frontend Sync button.

## Cost summary

Once a month, with everything running:

| Resource | Plan | Cost |
|---|---|---|
| crops-api dyno | Basic | $7 |
| crops-web dyno | Basic | $7 |
| Heroku Postgres | mini | $5 |
| **Total** | | **$19/mo** |

If you need more memory for ML training or higher traffic capacity, Standard-1X dynos are $25/mo each — bringing the total to ~$55/mo.
