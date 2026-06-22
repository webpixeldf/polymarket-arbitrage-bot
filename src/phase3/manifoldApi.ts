import axios from 'axios';

const MANIFOLD_BASE = 'https://api.manifold.markets/v0';

export interface ManifoldMarket {
  id: string;
  question: string;
  probability: number;     // 0-1 (already in correct scale)
  totalLiquidity: number;
  volume: number;
  closeTime: number;       // Unix ms
  url: string;
  outcomeType: string;
  isResolved: boolean;
}

async function fetchPage(offset: number): Promise<ManifoldMarket[]> {
  try {
    const resp = await axios.get(`${MANIFOLD_BASE}/markets`, {
      params: { limit: 500, sort: 'liquidity', order: 'desc', offset },
      timeout: 15000,
    });
    return Array.isArray(resp.data) ? resp.data : [];
  } catch {
    return [];
  }
}

export async function fetchManifoldMarkets(): Promise<ManifoldMarket[]> {
  try {
    const [page1, page2] = await Promise.all([
      fetchPage(0),
      fetchPage(500),
    ]);

    const all = [...page1, ...page2];

    return all.filter(m =>
      !m.isResolved &&
      m.outcomeType === 'BINARY' &&
      m.probability > 0.01 &&
      m.probability < 0.99 &&
      m.closeTime > Date.now() &&
      m.totalLiquidity > 50
    );
  } catch (err) {
    console.error('[Manifold] Failed to fetch markets:', (err as Error).message);
    return [];
  }
}
