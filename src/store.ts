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

interface BotStore {
  startedAt: string;
  markets: string[];
  prices: Record<string, PriceEntry>;
  trades: TradeEntry[];
  totalProfit: number;
  simulate: boolean;
}

export const store: BotStore = {
  startedAt: new Date().toISOString(),
  markets: [],
  prices: {},
  trades: [],
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
