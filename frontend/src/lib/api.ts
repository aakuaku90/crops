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
