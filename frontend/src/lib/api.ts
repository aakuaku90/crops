const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface PriceRecord {
  id: number;
  commodity_name: string;
  market_name: string;
  region: string | null;
  admin2: string | null;
  category: string | null;
  date: string;
  price: number;
  usd_price: number | null;
  unit: string | null;
  currency: string;
  price_type: string | null;
  price_flag: string | null;
  latitude: number | null;
  longitude: number | null;
  source: string;
}

export interface PriceSummary {
  commodity_name: string;
  latest_price: number;
  unit: string | null;
  currency: string;
  latest_date: string;
  avg_price: number;
  min_price: number;
  max_price: number;
  price_change_pct: number | null;
}

export interface TimeseriesPoint {
  date: string;
  market_name: string;
  region: string | null;
  avg_price: number;
  min_price: number;
  max_price: number;
  unit: string | null;
  currency: string;
}

export interface Commodity {
  name: string;
  unit: string | null;
}

export interface Market {
  name: string;
  region: string | null;
}

export async function getPriceSummary(): Promise<PriceSummary[]> {
  const res = await fetch(`${API_BASE}/api/v1/prices/summary`, {
    cache: "no-store",
  });
  if (!res.ok) return [];
  return res.json();
}

export async function getPriceTimeseries(
  commodity: string,
  market?: string,
  startDate?: string,
  endDate?: string
): Promise<TimeseriesPoint[]> {
  const params = new URLSearchParams({ commodity });
  if (market) params.set("market", market);
  if (startDate) params.set("start_date", startDate);
  if (endDate) params.set("end_date", endDate);

  const res = await fetch(`${API_BASE}/api/v1/prices/timeseries?${params}`, {
    next: { revalidate: 1800 },
  });
  if (!res.ok) return [];
  return res.json();
}

export async function getCommodities(): Promise<Commodity[]> {
  const res = await fetch(`${API_BASE}/api/v1/commodities/`, {
    next: { revalidate: 86400 },
  });
  if (!res.ok) return [];
  return res.json();
}

export async function getMarkets(): Promise<Market[]> {
  const res = await fetch(`${API_BASE}/api/v1/markets/`, {
    next: { revalidate: 86400 },
  });
  if (!res.ok) return [];
  return res.json();
}

export async function getPrices(params: {
  commodity?: string;
  market?: string;
  region?: string;
  start_date?: string;
  end_date?: string;
  limit?: number;
  offset?: number;
}): Promise<{ data: PriceRecord[]; total: number }> {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined) searchParams.set(k, String(v));
  });

  const res = await fetch(`${API_BASE}/api/v1/prices/?${searchParams}`, {
    cache: "no-store",
  });
  if (!res.ok) return { data: [], total: 0 };
  return res.json();
}

export async function triggerHdexSync(): Promise<{ status: string; records_inserted: number; message: string }> {
  const res = await fetch(`${API_BASE}/api/v1/sync/hdex`, { method: "POST" });
  return res.json();
}

// ── FAO FAOSTAT ──────────────────────────────────────────────────────────────

export interface FaoCpiRecord {
  id: number;
  start_date: string;
  end_date: string | null;
  item: string;
  element: string | null;
  months: string | null;
  year: number | null;
  value: number;
  unit: string | null;
  flag: string | null;
}

export interface FaoProducerPrice {
  id: number;
  start_date: string;
  end_date: string | null;
  item: string;
  element: string | null;
  year: number | null;
  value: number;
  unit: string | null;
  flag: string | null;
}

export async function getFaoCpi(item?: string): Promise<FaoCpiRecord[]> {
  const params = new URLSearchParams();
  if (item) params.set("item", item);
  const query = params.toString() ? `?${params}` : "";
  const res = await fetch(`${API_BASE}/api/v1/fao/cpi${query}`, {
    cache: "no-store",
  });
  if (!res.ok) return [];
  return res.json();
}

export async function getFaoProducerPrices(item?: string): Promise<FaoProducerPrice[]> {
  const params = new URLSearchParams();
  if (item) params.set("item", item);
  const query = params.toString() ? `?${params}` : "";
  const res = await fetch(`${API_BASE}/api/v1/fao/producer-prices${query}`, {
    cache: "no-store",
  });
  if (!res.ok) return [];
  return res.json();
}

export async function getFaoItems(): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/v1/fao/items`, {
    cache: "no-store",
  });
  if (!res.ok) return [];
  return res.json();
}

export async function triggerFaoCpiSync(): Promise<{
  status: string;
  records_inserted: number;
  message: string;
}> {
  const res = await fetch(`${API_BASE}/api/v1/sync/fao/cpi`, { method: "POST" });
  return res.json();
}

export async function triggerFaoProducerSync(): Promise<{
  status: string;
  records_inserted: number;
  message: string;
}> {
  const res = await fetch(`${API_BASE}/api/v1/sync/fao/producer-prices`, { method: "POST" });
  return res.json();
}

// ── FAO extended datasets ─────────────────────────────────────────────────────

export interface FaoHealthyDietCost {
  id: number;
  year: number;
  item: string;
  item_code: string | null;
  element: string | null;
  release: string | null;
  unit: string | null;
  value: number;
}

export interface FaoFoodSecurity {
  id: number;
  year_label: string;
  year_start: number | null;
  item: string;
  item_code: string | null;
  element: string | null;
  unit: string | null;
  value: number;
}

export interface FaoExchangeRate {
  id: number;
  year: number;
  months: string | null;
  months_code: string | null;
  element: string | null;
  element_code: string | null;
  currency: string | null;
  iso_currency_code: string | null;
  unit: string | null;
  value: number;
}

export interface FaoCropProduction {
  id: number;
  year: number;
  item: string;
  item_code: string | null;
  element: string | null;
  element_code: string | null;
  unit: string | null;
  value: number;
}

export interface FaoValueProduction {
  id: number;
  year: number;
  item: string;
  item_code: string | null;
  element: string | null;
  element_code: string | null;
  unit: string | null;
  value: number;
}

export interface FaoFoodBalance {
  id: number;
  year: number;
  item: string;
  item_code: string | null;
  element: string | null;
  element_code: string | null;
  unit: string | null;
  value: number;
}

export async function getFaoHealthyDietCost(item?: string): Promise<FaoHealthyDietCost[]> {
  const params = new URLSearchParams();
  if (item) params.set("item", item);
  const query = params.toString() ? `?${params}` : "";
  const res = await fetch(`${API_BASE}/api/v1/fao/healthy-diet-cost${query}`, {
    cache: "no-store",
  });
  if (!res.ok) return [];
  return res.json();
}

export async function getFaoFoodSecurity(item?: string): Promise<FaoFoodSecurity[]> {
  const params = new URLSearchParams();
  if (item) params.set("item", item);
  const query = params.toString() ? `?${params}` : "";
  const res = await fetch(`${API_BASE}/api/v1/fao/food-security${query}`, {
    cache: "no-store",
  });
  if (!res.ok) return [];
  return res.json();
}

export async function getFaoExchangeRates(element?: string): Promise<FaoExchangeRate[]> {
  const params = new URLSearchParams();
  if (element) params.set("element", element);
  const query = params.toString() ? `?${params}` : "";
  const res = await fetch(`${API_BASE}/api/v1/fao/exchange-rates${query}`, {
    cache: "no-store",
  });
  if (!res.ok) return [];
  return res.json();
}

export async function getFaoCropProduction(item?: string, element?: string, limit = 100, offset = 0): Promise<{ data: FaoCropProduction[]; total: number }> {
  const params = new URLSearchParams();
  if (item) params.set("item", item);
  if (element) params.set("element", element);
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  const res = await fetch(`${API_BASE}/api/v1/fao/crop-production?${params}`, { cache: "no-store" });
  if (!res.ok) return { data: [], total: 0 };
  return res.json();
}

export async function getFaoValueProduction(item?: string, element?: string, limit = 100, offset = 0): Promise<{ data: FaoValueProduction[]; total: number }> {
  const params = new URLSearchParams();
  if (item) params.set("item", item);
  if (element) params.set("element", element);
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  const res = await fetch(`${API_BASE}/api/v1/fao/value-production?${params}`, { cache: "no-store" });
  if (!res.ok) return { data: [], total: 0 };
  return res.json();
}

export async function getFaoFoodBalances(item?: string, element?: string, limit = 100, offset = 0): Promise<{ data: FaoFoodBalance[]; total: number }> {
  const params = new URLSearchParams();
  if (item) params.set("item", item);
  if (element) params.set("element", element);
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  const res = await fetch(`${API_BASE}/api/v1/fao/food-balances?${params}`, { cache: "no-store" });
  if (!res.ok) return { data: [], total: 0 };
  return res.json();
}

export async function getFaoFoodSecurityItems(): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/v1/fao/food-security/items`, {
    cache: "no-store",
  });
  if (!res.ok) return [];
  return res.json();
}

export async function getFaoCropProductionItems(): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/v1/fao/crop-production/items`, {
    cache: "no-store",
  });
  if (!res.ok) return [];
  return res.json();
}

export async function getFaoFoodBalanceItems(): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/v1/fao/food-balances/items`, {
    cache: "no-store",
  });
  if (!res.ok) return [];
  return res.json();
}

export async function getFaoValueProductionItems(): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/v1/fao/value-production/items`, {
    cache: "no-store",
  });
  if (!res.ok) return [];
  return res.json();
}

export async function triggerFaoHealthyDietSync(): Promise<{
  status: string;
  records_inserted: number;
  message: string;
}> {
  const res = await fetch(`${API_BASE}/api/v1/sync/fao/healthy-diet-cost`, { method: "POST" });
  return res.json();
}

export async function triggerFaoFoodSecuritySync(): Promise<{
  status: string;
  records_inserted: number;
  message: string;
}> {
  const res = await fetch(`${API_BASE}/api/v1/sync/fao/food-security`, { method: "POST" });
  return res.json();
}

export async function triggerFaoExchangeRatesSync(): Promise<{
  status: string;
  records_inserted: number;
  message: string;
}> {
  const res = await fetch(`${API_BASE}/api/v1/sync/fao/exchange-rates`, { method: "POST" });
  return res.json();
}

export async function triggerFaoCropProductionSync(): Promise<{
  status: string;
  records_inserted: number;
  message: string;
}> {
  const res = await fetch(`${API_BASE}/api/v1/sync/fao/crop-production`, { method: "POST" });
  return res.json();
}

export async function triggerFaoValueProductionSync(): Promise<{
  status: string;
  records_inserted: number;
  message: string;
}> {
  const res = await fetch(`${API_BASE}/api/v1/sync/fao/value-production`, { method: "POST" });
  return res.json();
}

export async function triggerFaoFoodBalancesSync(): Promise<{
  status: string;
  records_inserted: number;
  message: string;
}> {
  const res = await fetch(`${API_BASE}/api/v1/sync/fao/food-balances`, { method: "POST" });
  return res.json();
}

export interface FaoSupplyUtilization {
  id: number;
  year: number;
  item: string;
  item_code: string | null;
  element: string | null;
  element_code: string | null;
  unit: string | null;
  value: number;
}

export async function getFaoSupplyUtilization(item?: string, element?: string, limit = 100, offset = 0): Promise<{ data: FaoSupplyUtilization[]; total: number }> {
  const params = new URLSearchParams();
  if (item) params.set("item", item);
  if (element) params.set("element", element);
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  const res = await fetch(`${API_BASE}/api/v1/fao/supply-utilization?${params}`, { cache: "no-store" });
  if (!res.ok) return { data: [], total: 0 };
  return res.json();
}

export async function getFaoSupplyUtilizationItems(): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/v1/fao/supply-utilization/items`, { cache: "no-store" });
  if (!res.ok) return [];
  return res.json();
}

export async function triggerFaoSupplyUtilizationSync(): Promise<{
  status: string;
  records_inserted: number;
  message: string;
}> {
  const res = await fetch(`${API_BASE}/api/v1/sync/fao/supply-utilization`, { method: "POST" });
  return res.json();
}

export interface FaoPopulation {
  id: number;
  year: number;
  item: string;
  item_code: string | null;
  element: string | null;
  element_code: string | null;
  unit: string | null;
  value: number;
}

export async function getFaoPopulation(element?: string): Promise<FaoPopulation[]> {
  const params = new URLSearchParams();
  if (element) params.set("element", element);
  const query = params.toString() ? `?${params}` : "";
  const res = await fetch(`${API_BASE}/api/v1/fao/population${query}`, { cache: "no-store" });
  if (!res.ok) return [];
  return res.json();
}

export async function triggerFaoPopulationSync(): Promise<{
  status: string;
  records_inserted: number;
  message: string;
}> {
  const res = await fetch(`${API_BASE}/api/v1/sync/fao/population`, { method: "POST" });
  return res.json();
}

export type TradeCategory = "raw" | "processed";

export interface FaoTrade {
  id: number;
  year: number;
  item: string;
  item_code: string | null;
  element: string | null;
  element_code: string | null;
  unit: string | null;
  value: number;
  category: TradeCategory;
}

export async function getFaoTrade(
  item?: string,
  element?: string,
  limit = 100,
  offset = 0,
  category?: TradeCategory,
): Promise<{ data: FaoTrade[]; total: number }> {
  const params = new URLSearchParams();
  if (item) params.set("item", item);
  if (element) params.set("element", element);
  if (category) params.set("category", category);
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  const res = await fetch(`${API_BASE}/api/v1/fao/trade?${params}`, { cache: "no-store" });
  if (!res.ok) return { data: [], total: 0 };
  return res.json();
}

export async function getFaoTradeItems(): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/v1/fao/trade/items`, { cache: "no-store" });
  if (!res.ok) return [];
  return res.json();
}

export async function triggerFaoTradeSync(): Promise<{
  status: string;
  records_inserted: number;
  message: string;
}> {
  const res = await fetch(`${API_BASE}/api/v1/sync/fao/trade`, { method: "POST" });
  return res.json();
}

// ── FAO Fertilizer (RI) ───────────────────────────────────────────────────────

export interface FaoFertilizer {
  id: number;
  year: number;
  item: string;
  item_code: string | null;
  element: string | null;
  element_code: string | null;
  unit: string | null;
  value: number;
}

export async function getFaoFertilizer(item?: string, element?: string, limit = 100, offset = 0): Promise<{ data: FaoFertilizer[]; total: number }> {
  const params = new URLSearchParams();
  if (item) params.set("item", item);
  if (element) params.set("element", element);
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  const res = await fetch(`${API_BASE}/api/v1/fao/fertilizer?${params}`, { cache: "no-store" });
  if (!res.ok) return { data: [], total: 0 };
  return res.json();
}

export async function getFaoFertilizerItems(): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/v1/fao/fertilizer/items`, { cache: "no-store" });
  if (!res.ok) return [];
  return res.json();
}

export async function triggerFaoFertilizerSync(): Promise<{ status: string; records_inserted: number; message: string }> {
  const res = await fetch(`${API_BASE}/api/v1/sync/fao/fertilizer`, { method: "POST" });
  return res.json();
}

// ── FAO Land Use (RL) ─────────────────────────────────────────────────────────

export interface FaoLandUse {
  id: number;
  year: number;
  item: string;
  item_code: string | null;
  element: string | null;
  element_code: string | null;
  unit: string | null;
  value: number;
}

export async function getFaoLandUse(item?: string, element?: string, limit = 100, offset = 0): Promise<{ data: FaoLandUse[]; total: number }> {
  const params = new URLSearchParams();
  if (item) params.set("item", item);
  if (element) params.set("element", element);
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  const res = await fetch(`${API_BASE}/api/v1/fao/land-use?${params}`, { cache: "no-store" });
  if (!res.ok) return { data: [], total: 0 };
  return res.json();
}

export async function getFaoLandUseItems(): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/v1/fao/land-use/items`, { cache: "no-store" });
  if (!res.ok) return [];
  return res.json();
}

export async function triggerFaoLandUseSync(): Promise<{ status: string; records_inserted: number; message: string }> {
  const res = await fetch(`${API_BASE}/api/v1/sync/fao/land-use`, { method: "POST" });
  return res.json();
}

// ── GSS Sub-national Crop Production ─────────────────────────────────────────

export interface GssCropProduction {
  id: number;
  year: number;
  region: string;
  district: string;
  crop: string;
  element: string;
  unit: string | null;
  value: number | null;
  source: string;
}

export async function getGssCropProduction(params: {
  region?: string;
  district?: string;
  crop?: string;
  element?: string;
  year?: number;
  limit?: number;
  offset?: number;
}): Promise<{ data: GssCropProduction[]; total: number }> {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined) searchParams.set(k, String(v)); });
  const res = await fetch(`${API_BASE}/api/v1/gss/crop-production?${searchParams}`, { cache: "no-store" });
  if (!res.ok) return { data: [], total: 0 };
  return res.json();
}

export async function getGssRegions(): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/v1/gss/regions`, { cache: "no-store" });
  if (!res.ok) return [];
  return res.json();
}

export async function getGssDistricts(region?: string): Promise<string[]> {
  const params = region ? `?region=${encodeURIComponent(region)}` : "";
  const res = await fetch(`${API_BASE}/api/v1/gss/districts${params}`, { cache: "no-store" });
  if (!res.ok) return [];
  return res.json();
}

export async function getGssCrops(): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/v1/gss/crops`, { cache: "no-store" });
  if (!res.ok) return [];
  return res.json();
}

/**
 * Subset of GSS crops that have data in every dataset the Demand & Supply
 * Tracker page renders. Computed live on the backend so it stays accurate
 * as new syncs land.
 */
export async function getTrackerCrops(): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/v1/gss/tracker-crops`, { cache: "no-store" });
  if (!res.ok) return [];
  return res.json();
}

export interface GssYieldRow {
  year: number;
  region: string;
  district: string;
  crop: string;
  area_ha: number;
  production_mt: number;
  yield_mt_per_ha: number;
}

export async function getGssYields(params: {
  region?: string;
  district?: string;
  crop?: string;
  year?: number;
  limit?: number;
  offset?: number;
} = {}): Promise<{ data: GssYieldRow[]; total: number }> {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined) searchParams.set(k, String(v)); });
  const res = await fetch(`${API_BASE}/api/v1/gss/yields?${searchParams}`, { cache: "no-store" });
  if (!res.ok) return { data: [], total: 0 };
  return res.json();
}

export async function triggerGssNormalizeBackfill(): Promise<{
  crops_updated: number;
  regions_updated: number;
  districts_updated: number;
  alias_map_size: number;
}> {
  const res = await fetch(`${API_BASE}/api/v1/gss/normalize-backfill`, { method: "POST" });
  if (!res.ok) throw new Error("Backfill failed");
  return res.json();
}

// ── MoFA SRID national crop statistics (2019-2023) ─────────────────────────

export interface MofaNationalRow {
  id: number;
  year: number;
  crop: string;
  element: "Area" | "Production" | "Yield";
  unit: string | null;
  value: number | null;
  source: string;
}

export async function getMofaNational(params: {
  crop?: string;
  element?: "Area" | "Production" | "Yield";
  year?: number;
  limit?: number;
  offset?: number;
} = {}): Promise<{ data: MofaNationalRow[]; total: number }> {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined) searchParams.set(k, String(v)); });
  const res = await fetch(`${API_BASE}/api/v1/mofa/national?${searchParams}`, { cache: "no-store" });
  if (!res.ok) return { data: [], total: 0 };
  return res.json();
}

export async function getMofaCrops(): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/v1/mofa/crops`, { cache: "no-store" });
  if (!res.ok) return [];
  return res.json();
}

// ── Chat (Anthropic Claude with web search) ────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * POST /chat with the conversation so far. Streams Server-Sent Events back;
 * `onText` fires for each incremental text delta. Returns when the stream
 * ends or throws on error.
 */
export async function streamChat(
  crop: string,
  messages: ChatMessage[],
  onText: (text: string) => void,
  signal?: AbortSignal,
  options?: { webSearch?: boolean; region?: string | null },
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/v1/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      crop,
      messages,
      web_search: options?.webSearch ?? true,
      region: options?.region ?? null,
    }),
    signal,
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.detail) detail = body.detail;
    } catch { /* not JSON */ }
    throw new Error(detail);
  }
  if (!res.body) throw new Error("Streaming not supported");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const payload = JSON.parse(line.slice(6));
        if (payload.type === "text") onText(payload.text);
        if (payload.type === "error") throw new Error(payload.error);
      } catch (e) {
        if (e instanceof SyntaxError) continue;
        throw e;
      }
    }
  }
}

export interface GssSyncProgress {
  stage: "downloading" | "parsing" | "inserting" | "done" | "error";
  pct: number;
  done?: number;
  total?: number;
  records_inserted?: number;
  records_skipped?: number;
  message?: string;
}

export async function syncGssFromMofa(
  onProgress: (event: GssSyncProgress) => void,
): Promise<{ status: string; message: string }> {
  const res = await fetch(`${API_BASE}/api/v1/gss/sync`, { method: "POST" });
  if (!res.body) return { status: "error", message: "No response body" };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult: { status: string; message: string } = { status: "error", message: "Unknown error" };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          const event: GssSyncProgress = JSON.parse(line.slice(6));
          onProgress(event);
          if (event.stage === "done") {
            finalResult = { status: "success", message: event.message ?? "Sync complete" };
          } else if (event.stage === "error") {
            finalResult = { status: "error", message: event.message ?? "Sync failed" };
          }
        } catch { /* ignore malformed lines */ }
      }
    }
  }

  return finalResult;
}

export async function uploadGssCsv(
  file: File,
  onProgress: (event: GssSyncProgress) => void,
): Promise<{ status: string; message: string }> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/api/v1/gss/upload`, { method: "POST", body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Upload failed" }));
    return { status: "error", message: err.detail ?? "Upload failed" };
  }
  if (!res.body) return { status: "error", message: "No response body" };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult: { status: string; message: string } = { status: "error", message: "Unknown error" };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          const event: GssSyncProgress = JSON.parse(line.slice(6));
          onProgress(event);
          if (event.stage === "done") {
            finalResult = { status: "success", message: event.message ?? "Upload complete" };
          } else if (event.stage === "error") {
            finalResult = { status: "error", message: event.message ?? "Upload failed" };
          }
        } catch { /* ignore malformed lines */ }
      }
    }
  }

  return finalResult;
}

// ── Forecast-pipeline data: climate (X) + regional maize (Y) ─────────────────

export interface ClimateMonthlyRow {
  region: string;
  year: number;
  month: number;
  t2m: number | null;
  t2m_max: number | null;
  t2m_min: number | null;
  t2m_range: number | null;
  rh2m: number | null;
  total_precip_mm: number | null;
  avg_precip_mm: number | null;
  rainy_days: number | null;
  gwetroot: number | null;
  ndvi: number | null;
  evi: number | null;
  // (other columns also returned by the API; only the commonly-charted ones typed here)
  [k: string]: number | string | null;
}

export interface ClimateAnnualRow {
  region: string;
  year: number;
  [k: string]: number | string | null;
}

export interface ClimateSummary {
  monthly: { rows: number; year_min: number | null; year_max: number | null };
  annual: { rows: number; year_min: number | null; year_max: number | null };
}

export async function getClimateRegions(): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/v1/climate/regions`, { cache: "no-store" });
  if (!res.ok) return [];
  return res.json();
}

export async function getClimateMonthly(params: {
  region?: string;
  year?: number;
  yearFrom?: number;
  yearTo?: number;
  limit?: number;
  offset?: number;
} = {}): Promise<{ data: ClimateMonthlyRow[]; total: number }> {
  const sp = new URLSearchParams();
  if (params.region) sp.set("region", params.region);
  if (params.year != null) sp.set("year", String(params.year));
  if (params.yearFrom != null) sp.set("year_from", String(params.yearFrom));
  if (params.yearTo != null) sp.set("year_to", String(params.yearTo));
  sp.set("limit", String(params.limit ?? 2000));
  sp.set("offset", String(params.offset ?? 0));
  const res = await fetch(`${API_BASE}/api/v1/climate/monthly?${sp}`, { cache: "no-store" });
  if (!res.ok) return { data: [], total: 0 };
  return res.json();
}

export async function getClimateAnnual(params: {
  region?: string;
  yearFrom?: number;
  yearTo?: number;
  limit?: number;
  offset?: number;
} = {}): Promise<{ data: ClimateAnnualRow[]; total: number }> {
  const sp = new URLSearchParams();
  if (params.region) sp.set("region", params.region);
  if (params.yearFrom != null) sp.set("year_from", String(params.yearFrom));
  if (params.yearTo != null) sp.set("year_to", String(params.yearTo));
  sp.set("limit", String(params.limit ?? 2000));
  sp.set("offset", String(params.offset ?? 0));
  const res = await fetch(`${API_BASE}/api/v1/climate/annual?${sp}`, { cache: "no-store" });
  if (!res.ok) return { data: [], total: 0 };
  return res.json();
}

export async function getClimateSummary(): Promise<ClimateSummary> {
  const res = await fetch(`${API_BASE}/api/v1/climate/summary`, { cache: "no-store" });
  if (!res.ok) return { monthly: { rows: 0, year_min: null, year_max: null }, annual: { rows: 0, year_min: null, year_max: null } };
  return res.json();
}

export interface MofaRegionalMaizeRow {
  year: number;
  region: string;
  total_area_ha: number | null;
  avg_yield_mt_ha: number | null;
  total_production_mt: number | null;
  source: string;
}

export async function getMofaRegionalMaize(params: {
  region?: string;
  year?: number;
  yearFrom?: number;
  yearTo?: number;
  limit?: number;
  offset?: number;
} = {}): Promise<{ data: MofaRegionalMaizeRow[]; total: number }> {
  const sp = new URLSearchParams();
  if (params.region) sp.set("region", params.region);
  if (params.year != null) sp.set("year", String(params.year));
  if (params.yearFrom != null) sp.set("year_from", String(params.yearFrom));
  if (params.yearTo != null) sp.set("year_to", String(params.yearTo));
  sp.set("limit", String(params.limit ?? 1000));
  sp.set("offset", String(params.offset ?? 0));
  const res = await fetch(`${API_BASE}/api/v1/mofa/regional/maize?${sp}`, { cache: "no-store" });
  if (!res.ok) return { data: [], total: 0 };
  return res.json();
}

export async function getMofaRegionalRegions(): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/v1/mofa/regional/regions`, { cache: "no-store" });
  if (!res.ok) return [];
  return res.json();
}

// SSE-style sync helpers — same shape as syncGssFromMofa.
async function streamSyncSse(
  url: string,
  onProgress: (e: GssSyncProgress) => void,
): Promise<{ status: string; message: string }> {
  const res = await fetch(url, { method: "POST" });
  if (!res.body) return { status: "error", message: "No response body" };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let final: { status: string; message: string } = { status: "error", message: "Sync did not complete" };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          const event: GssSyncProgress = JSON.parse(line.slice(6));
          onProgress(event);
          if (event.stage === "done") final = { status: "success", message: event.message ?? "Sync complete" };
          else if (event.stage === "error") final = { status: "error", message: event.message ?? "Sync failed" };
        } catch { /* ignore malformed lines */ }
      }
    }
  }
  return final;
}

export function syncClimate(onProgress: (e: GssSyncProgress) => void) {
  return streamSyncSse(`${API_BASE}/api/v1/climate/sync`, onProgress);
}

export function syncMofaRegionalMaize(onProgress: (e: GssSyncProgress) => void) {
  return streamSyncSse(`${API_BASE}/api/v1/mofa/regional/sync`, onProgress);
}

// ── Maize predictions (TabPFN) ────────────────────────────────────────────────

export interface MaizePredictionRow {
  region: string;
  year: number;
  source: string;
  actual_yield: number | null;
  pred_yield: number | null;
  actual_area: number | null;
  pred_area: number | null;
  actual_production: number | null;
  pred_production: number | null;
}

export interface MaizePredictionsSummary {
  total: number;
  backtest_rows: number;
  future_rows: number;
  future_horizon_year: number | null;
  backtest_year_min: number | null;
  backtest_year_max: number | null;
  yield_rmse_mt_ha: number | null;
}

export async function getMaizePredictionsRegions(): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/v1/predictions/maize/regions`, { cache: "no-store" });
  if (!res.ok) return [];
  return res.json();
}

export async function getMaizePredictions(params: {
  region?: string;
  source?: "backtest" | "future_tabpfn";
  year?: number;
  yearFrom?: number;
  yearTo?: number;
  limit?: number;
  offset?: number;
} = {}): Promise<{ data: MaizePredictionRow[]; total: number }> {
  const sp = new URLSearchParams();
  if (params.region) sp.set("region", params.region);
  if (params.source) sp.set("source", params.source);
  if (params.year != null) sp.set("year", String(params.year));
  if (params.yearFrom != null) sp.set("year_from", String(params.yearFrom));
  if (params.yearTo != null) sp.set("year_to", String(params.yearTo));
  sp.set("limit", String(params.limit ?? 2000));
  sp.set("offset", String(params.offset ?? 0));
  const res = await fetch(`${API_BASE}/api/v1/predictions/maize?${sp}`, { cache: "no-store" });
  if (!res.ok) return { data: [], total: 0 };
  return res.json();
}

export async function getMaizePredictionsSummary(): Promise<MaizePredictionsSummary> {
  const res = await fetch(`${API_BASE}/api/v1/predictions/maize/summary`, { cache: "no-store" });
  if (!res.ok) {
    return {
      total: 0,
      backtest_rows: 0,
      future_rows: 0,
      future_horizon_year: null,
      backtest_year_min: null,
      backtest_year_max: null,
      yield_rmse_mt_ha: null,
    };
  }
  return res.json();
}

export function syncMaizePredictions(onProgress: (e: GssSyncProgress) => void) {
  return streamSyncSse(`${API_BASE}/api/v1/predictions/maize/sync`, onProgress);
}

// ── Generic maize-prediction client (works for any model) ────────────────────
// All three model endpoints share the same response shape and route layout
// (`/maize`, `/maize/regions`, `/maize/summary`, `/maize/sync`). This factory
// avoids triplicating the per-model client functions.

export function maizePredictionsClient(apiPathBase: string) {
  const base = `${API_BASE}${apiPathBase}`;

  return {
    getRegions: async (): Promise<string[]> => {
      const res = await fetch(`${base}/maize/regions`, { cache: "no-store" });
      if (!res.ok) return [];
      return res.json();
    },

    getSummary: async (): Promise<MaizePredictionsSummary> => {
      const res = await fetch(`${base}/maize/summary`, { cache: "no-store" });
      if (!res.ok) {
        return {
          total: 0, backtest_rows: 0, future_rows: 0,
          future_horizon_year: null,
          backtest_year_min: null, backtest_year_max: null,
          yield_rmse_mt_ha: null,
        };
      }
      return res.json();
    },

    list: async (params: {
      region?: string;
      source?: string;
      year?: number;
      yearFrom?: number;
      yearTo?: number;
      limit?: number;
      offset?: number;
    } = {}): Promise<{ data: MaizePredictionRow[]; total: number }> => {
      const sp = new URLSearchParams();
      if (params.region) sp.set("region", params.region);
      if (params.source) sp.set("source", params.source);
      if (params.year != null) sp.set("year", String(params.year));
      if (params.yearFrom != null) sp.set("year_from", String(params.yearFrom));
      if (params.yearTo != null) sp.set("year_to", String(params.yearTo));
      sp.set("limit", String(params.limit ?? 2000));
      sp.set("offset", String(params.offset ?? 0));
      const res = await fetch(`${base}/maize?${sp}`, { cache: "no-store" });
      if (!res.ok) return { data: [], total: 0 };
      return res.json();
    },

    sync: (onProgress: (e: GssSyncProgress) => void) =>
      streamSyncSse(`${base}/maize/sync`, onProgress),
  };
}

// ── Evaluation: cross-model comparison ───────────────────────────────────────

export interface EvaluationModelMetrics {
  n: number;
  rmse: number;
  mae: number;
  smape_pct: number | null;
  r2: number | null;
  bias: number;
  mase: number | null;
}

export interface EvaluationPairTest {
  model_a: string;
  model_b: string;
  mean_sq_diff: number;
  t_statistic: number;
  p_value: number;
  winner: string;
}

export interface EvaluationTargetMetrics {
  common_n: number;
  naive_mae: number | null;
  per_model: Record<string, EvaluationModelMetrics>;
  pair_tests: EvaluationPairTest[];
  error?: string;
}

export interface EvaluationResult {
  common_count: number;
  own_counts: Record<string, number>;
  models: string[];
  metrics: Record<"yield" | "area" | "production", EvaluationTargetMetrics>;
  error?: string;
}

export async function getMaizeEvaluation(): Promise<EvaluationResult> {
  const res = await fetch(`${API_BASE}/api/v1/evaluation/maize`, { cache: "no-store" });
  if (!res.ok) {
    return {
      common_count: 0,
      own_counts: {},
      models: [],
      metrics: {} as never,
      error: `HTTP ${res.status}`,
    };
  }
  return res.json();
}

// ── Maize price forecast (Prophet, per-market) ────────────────────────────────

export type PriceForecastPhase = "train" | "backtest" | "forecast";

export interface MaizePriceForecastRow {
  market: string;
  region: string | null;
  month_date: string; // ISO date (first of month)
  phase: PriceForecastPhase;
  actual_price_ghs: number | null;
  actual_price_usd: number | null;
  pred_price_ghs: number | null;
  pred_price_lower_ghs: number | null;
  pred_price_upper_ghs: number | null;
  pred_price_usd: number | null;
  pred_price_lower_usd: number | null;
  pred_price_upper_usd: number | null;
  cpi_value: number | null;
  unit: string | null;
}

export interface MaizePriceForecastMeta {
  market: string;
  region: string | null;
  unit: string | null;
  n_train: number;
  n_backtest: number;
  backtest_rmse_ghs: number | null;
  backtest_mae_ghs: number | null;
  backtest_mape_pct: number | null;
  cpi_beta: number | null;
  last_history_date: string | null;
  forecast_horizon_date: string | null;
  generated_at: string | null;
}

export interface MaizePriceForecastSummary {
  n_markets: number;
  horizon_date: string | null;
  last_history_date: string | null;
  avg_backtest_rmse_ghs: number | null;
  avg_backtest_mape_pct: number | null;
  avg_pred_horizon_ghs: number | null;
}

export async function getMaizePriceForecastMarkets(): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/v1/price-forecast/maize/markets`, {
    cache: "no-store",
  });
  if (!res.ok) return [];
  return res.json();
}

export async function getMaizePriceForecast(params: {
  market?: string;
  phase?: PriceForecastPhase;
  limit?: number;
  offset?: number;
} = {}): Promise<{ data: MaizePriceForecastRow[]; total: number }> {
  const sp = new URLSearchParams();
  if (params.market) sp.set("market", params.market);
  if (params.phase) sp.set("phase", params.phase);
  sp.set("limit", String(params.limit ?? 5000));
  sp.set("offset", String(params.offset ?? 0));
  const res = await fetch(`${API_BASE}/api/v1/price-forecast/maize?${sp}`, {
    cache: "no-store",
  });
  if (!res.ok) return { data: [], total: 0 };
  return res.json();
}

export async function getMaizePriceForecastMeta(): Promise<MaizePriceForecastMeta[]> {
  const res = await fetch(`${API_BASE}/api/v1/price-forecast/maize/meta`, {
    cache: "no-store",
  });
  if (!res.ok) return [];
  return res.json();
}

export async function getMaizePriceForecastSummary(): Promise<MaizePriceForecastSummary> {
  const res = await fetch(`${API_BASE}/api/v1/price-forecast/maize/summary`, {
    cache: "no-store",
  });
  if (!res.ok) {
    return {
      n_markets: 0,
      horizon_date: null,
      last_history_date: null,
      avg_backtest_rmse_ghs: null,
      avg_backtest_mape_pct: null,
      avg_pred_horizon_ghs: null,
    };
  }
  return res.json();
}

export function syncMaizePriceForecast(onProgress: (e: GssSyncProgress) => void) {
  return streamSyncSse(`${API_BASE}/api/v1/price-forecast/maize/sync`, onProgress);
}
