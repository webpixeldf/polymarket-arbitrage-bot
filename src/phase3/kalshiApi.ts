import axios from 'axios';

const KALSHI_BASE = process.env.KALSHI_API_URL ?? 'https://trading-api.kalshi.com/trade-api/v2';

export interface KalshiMarket {
  ticker: string;
  event_ticker: string;
  title: string;
  subtitle: string;
  status: string;
  yes_bid: number;    // cents: 0-100
  yes_ask: number;
  no_bid: number;
  no_ask: number;
  last_price: number;
  volume: number;
  volume_24h: number;
  open_interest: number;
  close_time: string;
  category: string;
}

export function kalshiYesPrice(m: KalshiMarket): number {
  // Returns 0-1 probability (Kalshi prices are in cents 0-100)
  const bid = m.yes_bid ?? 0;
  const ask = m.yes_ask ?? 0;
  if (bid > 0 && ask > 0) return (bid + ask) / 2 / 100;
  if (m.last_price > 0) return m.last_price / 100;
  return -1;
}

async function fetchPage(cursor?: string): Promise<{ markets: KalshiMarket[]; cursor?: string }> {
  try {
    const params: Record<string, string | number> = { limit: 200, status: 'open' };
    if (cursor) params.cursor = cursor;

    const resp = await axios.get(`${KALSHI_BASE}/markets`, {
      params,
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000,
    });
    return {
      markets: resp.data?.markets ?? [],
      cursor: resp.data?.cursor,
    };
  } catch {
    return { markets: [] };
  }
}

export async function fetchKalshiMarkets(): Promise<KalshiMarket[]> {
  try {
    // Fetch up to 2 pages (400 markets max)
    const page1 = await fetchPage();
    const markets = [...page1.markets];

    if (page1.cursor && markets.length >= 200) {
      const page2 = await fetchPage(page1.cursor);
      markets.push(...page2.markets);
    }

    // Only open markets with some recent activity
    return markets.filter(m => m.status === 'open' && (m.volume_24h ?? 0) > 50);
  } catch (err) {
    console.error('[Kalshi] Failed to fetch markets:', (err as Error).message);
    return [];
  }
}
