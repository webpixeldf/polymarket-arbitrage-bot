export interface GammaMarket {
  conditionId: string;
  question: string;
  endDate: string;        // ISO datetime: "2026-06-22T09:30:00Z"
  endDateIso: string;     // Date only: "2026-06-22"
  active: boolean;
  clobTokenIds: string;   // JSON string: "[\"123...\", \"456...\"]"
  outcomes: string;       // JSON string: "[\"Up\", \"Down\"]"
  slug: string;
  restricted: boolean;
}

export interface PriceSnapshot {
  timestamp: number;
  ask: number;
}

export interface LegState {
  filled: boolean;
  tokenId: string;
  entryPrice: number | null;
  orderId: string | null;
}

export interface TradeRecord {
  asset: string;
  roundEnd: string;
  leg1Price: number;
  leg2Price: number;
  combined: number;
  target: number;
  mode: 'hedge' | 'stop-loss';
  timestamp: string;
}

export interface OrderBookEntry {
  price: string;
  size: string;
}

export interface OrderBook {
  asks: OrderBookEntry[];
  bids: OrderBookEntry[];
}
