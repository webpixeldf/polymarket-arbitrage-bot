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
  slug: string;
  category: string;
  marketProb: number;
  aiProb: number;
  edge: number;
  recommendation: string;
  confidence: number;
  reasoning: string;
  timestamp: string;
}

interface BotStore {
  startedAt: string;
  markets: string[];
  prices: Record<string, PriceEntry>;
  trades: TradeEntry[];
  valueBets: ValueBetEntry[];
  totalProfit: number;
  simulate: boolean;
}

export const store: BotStore = {
  startedAt: new Date().toISOString(),
  markets: [],
  prices: {},
  trades: [],
  valueBets: [],
  totalProfit: 0,
  simulate: true,
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
    slug: vb.market.slug,
    category: vb.category,
    marketProb: vb.market.probability,
    aiProb: vb.analysis.probability,
    edge: vb.edge,
    recommendation: vb.recommendation,
    confidence: vb.analysis.confidence,
    reasoning: vb.analysis.reasoning,
    timestamp: vb.timestamp,
  };
  store.valueBets.unshift(entry);
  if (store.valueBets.length > 50) store.valueBets.pop();
}
