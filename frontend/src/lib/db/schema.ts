import {
  pgTable,
  serial,
  varchar,
  decimal,
  date,
  integer,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";

export const commodities = pgTable("commodities", {
  id: serial("id").primaryKey(),
  wfpId: integer("wfp_id").unique(),
  name: varchar("name", { length: 255 }).notNull(),
  category: varchar("category", { length: 100 }),
  unit: varchar("unit", { length: 50 }),
  createdAt: timestamp("created_at").defaultNow(),
});

export const markets = pgTable("markets", {
  id: serial("id").primaryKey(),
  wfpId: integer("wfp_id").unique(),
  name: varchar("name", { length: 255 }).notNull(),
  region: varchar("region", { length: 100 }),
  latitude: decimal("latitude", { precision: 9, scale: 6 }),
  longitude: decimal("longitude", { precision: 9, scale: 6 }),
  createdAt: timestamp("created_at").defaultNow(),
});

export const foodPrices = pgTable(
  "food_prices",
  {
    id: serial("id").primaryKey(),
    commodityId: integer("commodity_id").references(() => commodities.id),
    marketId: integer("market_id").references(() => markets.id),
    commodityName: varchar("commodity_name", { length: 255 }),
    marketName: varchar("market_name", { length: 255 }),
    region: varchar("region", { length: 100 }),
    date: date("date").notNull(),
    price: decimal("price", { precision: 10, scale: 2 }).notNull(),
    unit: varchar("unit", { length: 50 }),
    currency: varchar("currency", { length: 10 }).default("GHS"),
    priceType: varchar("price_type", { length: 50 }),
    priceFlag: varchar("price_flag", { length: 10 }),
    source: varchar("source", { length: 50 }).default("wfp"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (t) => ({
    dateIdx: index("idx_food_prices_date").on(t.date),
    commodityIdx: index("idx_food_prices_commodity").on(t.commodityName),
    marketIdx: index("idx_food_prices_market").on(t.marketName),
    regionIdx: index("idx_food_prices_region").on(t.region),
    uniqueEntry: unique().on(t.commodityName, t.marketName, t.date, t.priceType),
  })
);

export type Commodity = typeof commodities.$inferSelect;
export type Market = typeof markets.$inferSelect;
export type FoodPrice = typeof foodPrices.$inferSelect;
