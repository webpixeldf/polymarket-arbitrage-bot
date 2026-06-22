export interface PriceEntry {
  up: number | null;
  down: number | null;
  updatedAt: string;
}

export interface TradeEntry {
  asset: string;
  leg: 'UP' | 'DOWN';
  leg1Price: number;
  leg2Price: number;
  combined: number;
  target: number;
  profit: number;
  mode: 'hedge' | 'stop-loss';
  simulate: boolean;
  timestamp: string;
}

export interface ScalperTrade {
  asset: string;
  side: 'UP' | 'DOWN';
  entryPrice: number;
  secsAtEntry: number;
  betUsdc: number;
  potentialProfit: number;
  simulate: boolean;
  timestamp: string;
  marketEndTime: string;
  settled: boolean;
  won: boolean | null;
  pnl: number | null;
}

export interface ValueBetEntry {
  conditionId: string;
  question: string;
  questionPT: string;
  slug: string;
  eventSlug: string;
  marketProb: number;
  aiProb: number;
  edge: number;
  confidence: number;
  reasoning: string;
  liquidity: number;
  daysToEnd: number;
  recommendation: 'BUY_YES' | 'BUY_NO';
  simulate: boolean;
  timestamp: string;
}

interface BotStore {
  startedAt: string;
  markets: string[];
  prices: Record<string, PriceEntry>;
  trades: TradeEntry[];
  totalProfit: number;
  simulate: boolean;
  scalperTrades: ScalperTrade[];
  scalperProfit: number;
  walletBalance: number | null;
  walletUpdatedAt: string | null;
  valueBets: ValueBetEntry[];
  lastScanAt: string | null;
}

export const store: BotStore = {
  startedAt: new Date().toISOString(),
  markets: [],
  prices: {},
  trades: [],
  totalProfit: 0,
  simulate: true,
  scalperTrades: [],
  scalperProfit: 0,
  walletBalance: null,
  walletUpdatedAt: null,
  valueBets: [],
  lastScanAt: null,
};

export function updatePrice(asset: string, side: 'up' | 'down', price: number): void {
  if (!store.prices[asset]) {
    store.prices[asset] = { up: null, down: null, updatedAt: new Date().toISOString() };
  }
  store.prices[asset][side] = price;
  store.prices[asset].updatedAt = new Date().toISOString();
}

export function addTrade(trade: TradeEntry): void {
  store.trades.unshift(trade);
  if (store.trades.length > 100) store.trades.pop();
  if (trade.mode === 'hedge') {
    store.totalProfit += trade.profit;
  }
}
