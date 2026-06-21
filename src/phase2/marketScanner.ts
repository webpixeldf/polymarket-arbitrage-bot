import axios from 'axios';
import { Category, detectCategory } from './newsCollector';

const GAMMA_API = process.env.GAMMA_API_URL ?? 'https://gamma-api.polymarket.com';

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  worldcup: ['world cup', 'fifa', 'copa', 'soccer', 'football', 'goal', 'match', 'tournament',
             'semifinal', 'final', 'champion', 'brazil', 'argentina', 'france', 'england',
             'germany', 'spain', 'portugal', 'group stage', 'knockout'],
  elections: ['election', 'president', 'vote', 'poll', 'senator', 'governor', 'primary',
              'ballot', 'candidate', 'party', 'democrat', 'republican', 'congress', 'parliament'],
  climate: ['hurricane', 'storm', 'temperature', 'weather', 'flood', 'drought', 'wildfire',
            'tornado', 'earthquake', 'rainfall', 'snow', 'record heat', 'el nino'],
  politics: ['trump', 'congress', 'senate', 'white house', 'supreme court', 'legislation',
             'republican', 'democrat', 'impeach', 'veto', 'executive order'],
  finance: ['fed', 'interest rate', 'inflation', 'gdp', 'recession', 'stock', 'dow',
            'nasdaq', 'economy', 'treasury', 'tariff', 'market crash'],
  geopolitics: ['iran', 'russia', 'ukraine', 'china', 'taiwan', 'nato', 'war', 'sanction',
                'missile', 'nuclear', 'north korea', 'middle east', 'ceasefire'],
  sports: ['nfl', 'nba', 'nhl', 'mlb', 'formula', 'tennis', 'basketball', 'baseball', 'ufc'],
  tech: ['ai', 'openai', 'apple', 'google', 'microsoft', 'technology', 'elon', 'meta', 'model'],
  general: [],
};

export interface EventMarket {
  conditionId: string;
  question: string;
  slug: string;
  endDate: string;
  liquidity: number;
  probability: number;    // current market probability (0-100)
  category: Category;
  volume: number;
}

export async function scanEventMarkets(): Promise<EventMarket[]> {
  try {
    const resp = await axios.get(`${GAMMA_API}/markets`, {
      params: {
        active: true,
        limit: 500,
        order: 'liquidityNum',
        ascending: false,
      },
      timeout: 15000,
    });

    const markets = resp.data as any[];
    const results: EventMarket[] = [];

    for (const m of markets) {
      if (!m.question || !m.conditionId || !m.outcomePrices) continue;

      // Skip crypto 15m markets (handled by Phase 1)
      if (m.slug && (m.slug.includes('updown') || m.slug.includes('15m') || m.slug.includes('5m'))) continue;

      // Skip markets with less than $1000 liquidity
      const liquidity = parseFloat(m.liquidityNum ?? m.liquidity ?? '0');
      if (liquidity < 1000) continue;

      // Detect category
      const category = detectCategory(m.question);

      // Only include markets matching our target categories
      const keywords = [
        ...CATEGORY_KEYWORDS.worldcup,
        ...CATEGORY_KEYWORDS.elections,
        ...CATEGORY_KEYWORDS.climate,
      ];
      const q = m.question.toLowerCase();
      const matches = keywords.some(kw => q.includes(kw));
      if (!matches && category === 'general') continue;

      // Parse probability from outcomePrices (first outcome = YES)
      let probability = 50;
      try {
        const prices = JSON.parse(m.outcomePrices);
        probability = parseFloat(prices[0]) * 100;
      } catch { /* skip */ }

      results.push({
        conditionId: m.conditionId,
        question: m.question,
        slug: m.slug ?? '',
        endDate: m.endDate ?? m.endDateIso ?? '',
        liquidity,
        probability,
        category,
        volume: parseFloat(m.volume ?? '0'),
      });
    }

    return results;
  } catch (err) {
    console.error('[Scanner] Failed to scan markets:', (err as Error).message);
    return [];
  }
}
