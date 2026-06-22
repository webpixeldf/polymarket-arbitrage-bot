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

export interface ValueBetEntry {
  question: string;
  questionPT: string;
  slug: string;
  conditionId: string;
  eventSlug: string;
  category: string;
  marketProb: number;
  aiProb: number;
  edge: number;
  recommendation: string;
  confidence: number;
  reasoning: string;
  bullishFactors: string[];
  bearishFactors: string[];
  timestamp: string;
}

export interface AnalyzedMarketEntry {
  question: string;
  questionPT: string;
  slug: string;
  conditionId: string;
  eventSlug: string;
  category: string;
  marketProb: number;
  aiProb: number;
  edge: number;
  confidence: number;
  isValueBet: boolean;
  timestamp: string;
}

export interface OrderEntry {
  question: string;
  questionPT: string;
  side: 'YES' | 'NO';
  price: number;
  amountUsdc: number;
  orderId: string | null;
  edge: number;
  timestamp: string;
  simulate: boolean;
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

export interface CrossArbEntry {
  kalshiTicker: string;
  kalshiTitle: string;
  kalshiProb: number;
  polyQuestion: string;
  polyEventSlug: string;
  polyProb: number;
  divergence: number;
  recommendation: 'BUY_YES' | 'BUY_NO';
  matchScore: number;
  polyLiquidity: number;
  timestamp: string;
}

interface BotStore {
  startedAt: string;
  markets: string[];
  prices: Record<string, PriceEntry>;
  trades: TradeEntry[];
  valueBets: ValueBetEntry[];
  analyzedMarkets: AnalyzedMarketEntry[];
  orders: OrderEntry[];
  totalProfit: number;
  simulate: boolean;
  lastScanAt: string | null;
  crossArbOpportunities: CrossArbEntry[];
  lastCrossArbScanAt: string | null;
  scalperTrades: ScalperTrade[];
  scalperProfit: number;
}

export const store: BotStore = {
  startedAt: new Date().toISOString(),
  markets: [],
  prices: {},
  trades: [],
  valueBets: [],
  analyzedMarkets: [],
  orders: [],
  totalProfit: 0,
  simulate: true,
  lastScanAt: null,
  crossArbOpportunities: [],
  lastCrossArbScanAt: null,
  scalperTrades: [],
  scalperProfit: 0,
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

export function addValueBet(vb: import('./phase2/valueBetDetector').ValueBet): void {
  const entry: ValueBetEntry = {
    question: vb.market.question,
    questionPT: vb.analysis.questionPT,
    slug: vb.market.slug,
    conditionId: vb.market.conditionId,
    eventSlug: vb.market.eventSlug,
    category: vb.category,
    marketProb: vb.market.probability,
    aiProb: vb.analysis.probability,
    edge: vb.edge,
    recommendation: vb.recommendation,
    confidence: vb.analysis.confidence,
    reasoning: vb.analysis.reasoning,
    bullishFactors: vb.analysis.bullishFactors,
    bearishFactors: vb.analysis.bearishFactors,
    timestamp: vb.timestamp,
  };
  store.valueBets.unshift(entry);
  if (store.valueBets.length > 50) store.valueBets.pop();
}

export function addOrder(order: OrderEntry): void {
  store.orders.unshift(order);
  if (store.orders.length > 50) store.orders.pop();
}

export function addAnalyzedMarket(entry: AnalyzedMarketEntry): void {
  // Replace if same question already exists (update from new scan)
  const idx = store.analyzedMarkets.findIndex(m => m.question === entry.question);
  if (idx >= 0) {
    store.analyzedMarkets[idx] = entry;
  } else {
    store.analyzedMarkets.push(entry);
  }
  // Keep max 100, sorted by abs edge descending
  store.analyzedMarkets.sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge));
  if (store.analyzedMarkets.length > 100) store.analyzedMarkets.pop();
}
