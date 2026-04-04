# Ghana Food Demand & Supply Tracker — Data Analysis Progress Report

**Date:** April 2026
**Platform:** CROPS — Ghana Agricultural Data Platform

---

## 1. Application Setup & Technical Stack

### 1.1 Overview

The platform is a full-stack web application structured as a monorepo with three components: a Next.js frontend, a FastAPI backend, and a PostgreSQL database managed via Docker. All three services are started together using a single `npm run dev` command at the project root, which orchestrates Docker Compose, the Python API server, and the Next.js development server concurrently.

### 1.2 Frontend

The frontend is built with **Next.js 15** using the App Router, written entirely in **TypeScript** for end-to-end type safety across API calls and component props. Styling is handled by **Tailwind CSS**. All data visualisations — line charts, bar charts, and composed charts — are rendered using **Recharts**. Base UI components such as cards and loading skeletons are sourced from **shadcn/ui**, with a custom `SearchableSelect` component built for crop and filter selection across the dashboard.

The application has five pages. The landing page at `/` introduces the platform and its three data sections. The main analysis view lives at `/tracker` — the Demand & Supply Tracker — where users can select any crop and explore its full supply, demand, price, and trade picture. Supporting pages at `/dashboard`, `/fao`, and `/gss` provide detailed views into WFP food prices, FAO national indicators, and GSS sub-national production data respectively.

### 1.3 Backend

The API is built with **FastAPI**, a Python async web framework. Database queries are executed using **asyncpg**, an async PostgreSQL driver chosen for its performance with high-concurrency read workloads. Configuration and environment variables are managed through **pydantic-settings**, and the server is run with **uvicorn**. All I/O — database access, external API calls, file parsing — is handled asynchronously using Python's `asyncio`, keeping the server responsive during long-running data sync operations.

The API exposes routes under `/api/v1/` covering food prices, all FAO dataset endpoints, GSS sub-national data, and a set of `/sync/*` endpoints that trigger on-demand data pulls from external sources.

### 1.4 Database

**PostgreSQL 15** serves as the primary data store, running in a Docker container managed by Docker Compose. The schema — 18 tables covering all data sources — is initialised automatically on first startup. Indexes are created on the most frequently queried columns including date, commodity name, region, and year to keep query response times fast even across tables with tens of thousands of records.

### 1.5 Data Ingestion

FAO datasets are fetched on demand through the authenticated **FAOSTAT API**, triggered via sync endpoints in the backend. WFP retail price data is ingested from the **WFP DataBridges API** and the **HDEX public CSV**. GSS sub-national production data is loaded via manual CSV upload through the platform's upload interface.

For the GSS data specifically, a TRUNCATE + COPY pattern is used: on each upload, the entire table is cleared and replaced using PostgreSQL's native `COPY` command, which is significantly faster than row-by-row inserts for the 81,000+ records in the dataset. CSV parsing runs in a separate thread via `asyncio.to_thread` to avoid blocking the event loop, and progress is streamed to the browser in real time using **Server-Sent Events (SSE)**.

### 1.6 Development Tooling

The **concurrently** npm package is used to run the frontend, backend, and database in parallel from a single command. Docker Compose includes a health check on the PostgreSQL container so the API server does not start until the database is ready. The full development environment is brought up with:

```bash
npm run dev
```

---

## 2. Objective

The goal of this project is to build a demand and supply tracker for Ghana's food system using publicly available national and sub-national datasets. The platform consolidates data from three primary sources into a unified dashboard that enables analysis of production trends, consumption patterns, market prices, and trade flows — with the ability to drill down by crop and region.

---

## 3. Data Sources

### 3.1 World Food Programme (WFP) / Humanitarian Data Exchange (HDEX)

The WFP dataset provides retail food prices collected at the market level across Ghana, sourced via the WFP DataBridges API and the HDEX public CSV. It covers the period from January 2006 to July 2023 and contains 27,619 records spanning multiple commodities and markets across the country. This is the most granular price dataset in the platform — the only one that tracks prices at specific markets rather than national averages.

### 3.2 FAOSTAT — Food and Agriculture Organization of the United Nations

FAOSTAT is the primary source for national-level agricultural statistics. Data is pulled on demand via the authenticated FAOSTAT API across eleven distinct datasets. Together these datasets cover Ghana's agricultural system comprehensively — from raw production volumes and farmgate prices to food security outcomes and fertilizer inputs. A total of 252,459 FAO records have been ingested across all datasets, with year coverage varying by domain:

Crop production data spans 1961 to 2024 (15,243 records). Food balance data — which shows the full supply and utilisation account for each food commodity — spans 1961 to 2021 (22,975 records). Trade data covering imports and exports runs from 1961 to 2024 and is the largest single FAO dataset at 49,982 records. Supply utilisation accounts contain 55,273 records from 1961 to 2013. Producer prices cover 1991 to 2022 (3,734 records), while the consumer price index spans 1970 to 2023 (909 records). Food security indicators cover 2000 to 2022 (882 records). Population data, land use, fertilizer use, and healthy diet cost data are also ingested, providing contextual national indicators for the demand and supply analysis.

### 3.3 Ghana Statistical Service (GSS) / Ministry of Food and Agriculture (MoFA)

The GSS dataset provides sub-national crop production estimates at region and district level, sourced from the MoFA Spatial Research and Information Directorate (SRID) production estimates CSV. It covers 33 crops across 17 administrative regions and 412 districts, spanning 1999 to 2023. With 81,765 records, it is the largest single dataset in the platform and the only source of geographically granular production data for Ghana. Each record contains area cropped (hectares), average yield (Mt/ha), and production volume (Mt) at the district or region level.

---

## 4. What Was Built for the Demand & Supply Tracker

The tracker is the core analytical page of the platform. Users select a crop from the GSS crop list — which serves as the primary reference vocabulary — and the page loads data from all relevant sources simultaneously. The analysis is organised into four sections.

The **Supply** section shows production volume, area harvested, and yield over time from FAO crop production data; regional production aggregated by region from GSS sub-national records; a food balance breakdown showing how domestic supply is composed of production, imports, exports, and losses; national cropland and agricultural land area trends from FAO land use data; and national fertilizer use (Nitrogen, Phosphate, Potash) from FAO fertilizer records.

The **Demand** section shows food supply per capita in kg/year from FAO food balance data; the prevalence of undernourishment as a percentage of the population from FAO food security indicators; total population growth from FAO population data; and the cost of a healthy diet in USD/person/day from FAO healthy diet cost data.

The **Prices** section shows a monthly WFP retail price trend for the selected crop across Ghana markets; annual farmgate producer prices from FAO; the national food consumer price index from FAO CPI data; and a current price summary table with 30-day percentage change for matched WFP commodities.

The **Trade** section shows annual import and export volumes in tonnes from FAO trade data, covering 1961 to 2024, allowing users to assess the extent to which Ghana relies on imports to meet domestic demand for a given crop.

---

## 5. Focus Crops: Maize and Rice

### 5.1 Maize

Maize is Ghana's most widely grown staple crop and has the most complete data coverage across all sources in the platform. FAO records it as "Maize (corn)" in crop production data, covering 1961 to 2024. GSS records production across all 17 regions over 25 years (1999–2023), making it the crop with the broadest sub-national coverage in the dataset. WFP market price data is available from 2006 to 2023 across multiple markets.

Key observations from the data include a clear upward trend in WFP retail prices from 2006 to 2023, consistent with inflation and periodic supply pressure. FAO trade data indicates that Ghana is a net maize importer in a number of years, suggesting that domestic production does not consistently meet demand. The food balance data shows that maize food supply per capita has remained broadly stable over the long term, though price volatility in the market data suggests supply shocks at certain points.

### 5.2 Rice

Rice is a significant import commodity for Ghana, with growing domestic production concentrated in specific regions. FAO trade data, which runs to 2024, confirms that Ghana is a substantial net importer of rice, with import quantities consistently and significantly exceeding exports. This aligns with the known gap between domestic rice production and consumption demand in the country.

GSS regional production data covers all 17 regions across 25 years, with production historically concentrated in the Northern, Upper East, Upper West, and Volta regions. However, a data entry inconsistency in the source CSV — where some records use "RIce" with a capital I rather than "Rice" — results in the crop appearing under two separate entries in the database, causing some undercounting in regional aggregations for certain years. FAO crop production data runs from 1961 to 2024 under the item name "Rice". WFP retail price data is available from 2006 to 2023.

---

## 6. Challenges

### 6.1 Crop Name Mismatches Across Sources

Each data source uses its own naming conventions. FAO uses formal commodity names such as "Maize (corn)", "Cassava, fresh", and "Rice, paddy". GSS uses common local names — "Maize", "Cassava", "Rice". WFP commodity names are closer to GSS but not identical in all cases. These mismatches mean that a crop selected from the GSS list cannot always be passed directly to FAO or WFP queries and expect an exact match.

The platform addresses this using fuzzy ILIKE matching on the backend, so selecting "Cassava" from the GSS list generates a query for any FAO record where the item name contains "Cassava", which correctly returns "Cassava, fresh" and related derivatives. However, this approach has edge cases. Searching for "Rice" also returns "Rice paper" and other processed products in the FAO trade table, which slightly inflates reported trade volumes for that crop.

### 6.2 CPI Is National-Level Only

The FAO Consumer Price Index data available for Ghana contains only three aggregate indices: a general consumer price index, a food price index (both benchmarked at 2015 = 100), and a food price inflation measure. There is no crop-specific CPI, which means the CPI chart in the tracker reflects economy-wide and food-wide price pressure rather than price movements for individual crops. This limits its usefulness as a demand signal when analysing specific commodities like Maize or Rice.

### 6.3 Data Entry Inconsistencies in GSS Regional Data

The MoFA/GSS source CSV contains a number of data entry inconsistencies that were preserved during ingestion to maintain fidelity to the original source. These include capitalisation errors such as "RIce" instead of "Rice" and "MIllet" instead of "Millet", as well as case inconsistencies like "sweet Potato" versus "Sweet Potato". Because the database stores these as distinct values, some crops appear split across two entries in the crop selector and in regional aggregations. This affects the completeness of analysis for the affected crops.

### 6.4 Getting Granular with Regional Production Data

This is the most significant analytical challenge encountered in the project. While the GSS dataset contains 412 distinct districts, district-level records are not consistently available across all crops and all years. A substantial number of records have a blank district field, with data reported only at the region level. This makes it difficult to identify which specific districts within a region are primary production contributors, and limits the granularity of spatial analysis that can be done reliably.

A further complication arises from Ghana's administrative reorganisation. Several of the country's newer regions — including Ahafo, Bono East, North East, Oti, Savannah, and Western North — were created from older ones between 2018 and 2019. Historical production data for years prior to the split is attributed to the parent regions (for example, Brong Ahafo), creating a discontinuity in the time series that makes long-term regional trend comparisons difficult without manual reconciliation.

The GSS dataset also does not include derived yield figures at the district level. While area cropped and production volume are both present in principle, missing values stored as NULL in either field make reliable yield computation impossible for a meaningful portion of district records. Finally, because both region-level summary rows and district-level rows coexist in the dataset for the same crop-year combinations, straightforward aggregation risks double-counting production. The platform currently presents raw records without aggregation to avoid this, but it means that totals displayed require careful interpretation.

### 6.5 FAO Trade Data Includes Processed Derivatives

FAO trade data is structured around commodity codes and includes not only raw agricultural commodities but all processed derivatives. For rice, import figures in the database include "Rice, milled", "Husked rice", "Rice, broken", "Flour of rice", and "Rice paper", among others. When these are summed together, the resulting import volume overstates raw grain imports and cannot be directly compared with GSS production figures, which are recorded in fresh or raw weight equivalents. Disaggregating raw commodity trade from processed product trade requires additional filtering that has not yet been applied at the query level.

### 6.6 WFP Price Data Coverage Gap

The most recent WFP retail price data available through the current ingestion pipeline covers up to July 2023. As FAO trade and production data extends to 2024, this creates an approximate 12 to 18 month gap between the most recent price signals and the most recent supply and trade figures. This limits the ability to draw real-time demand-supply conclusions from the combined datasets and means that any recent price movements driven by the 2023–2024 production season are not visible in the tracker.

---

## 7. Next Steps

Normalising GSS crop name inconsistencies at the point of ingestion — correcting "RIce" to "Rice" and similar errors — would immediately improve the completeness of regional aggregations for affected crops. Separating raw commodity trade volumes from processed derivatives in the FAO trade analysis would make import and export figures more directly comparable with domestic production data. Investigating updated WFP price data sources to extend retail price coverage beyond July 2023 would close the current gap between price signals and supply data. Building a derived yield table from GSS area and production records — where both values are present and non-null — would enable regional yield comparisons that are not currently possible from the raw data. Longer term, exploring additional district-level production data sources would help address the granularity limitations identified in the GSS dataset.
