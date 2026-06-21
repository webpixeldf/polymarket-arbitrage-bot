import axios from 'axios';
import { Category, detectCategory } from './newsCollector';

const GAMMA_API = process.env.GAMMA_API_URL ?? 'https://gamma-api.polymarket.com';

// All keywords that identify markets we want to analyze
const ALL_KEYWORDS = [
  // World Cup — match specific (less efficient = more edge)
  'world cup', 'fifa', 'copa do mundo', 'copa mundial',
  'will brazil', 'will argentina', 'will france', 'will england',
  'will germany', 'will spain', 'will portugal', 'will netherlands',
  'will morocco', 'will usa', 'will mexico', 'will japan', 'will colombia',
  'advance to', 'reach the', 'group stage', 'knockout', 'round of 16',
  'quarterfinal', 'semifinal', 'world cup final', 'score in', 'goals in',
  // Elections
  'election', 'president', 'senator', 'governor', 'primary', 'ballot',
  'candidate', 'democrat', 'republican', 'congress', 'parliament', 'eleic',
  // Climate
  'hurricane', 'tropical storm', 'flood', 'drought', 'wildfire', 'tornado',
  'earthquake', 'el nino', 'record heat', 'record temperature',
  // Politics
  'trump', 'senate', 'supreme court', 'impeach', 'executive order',
  // Geopolitics
  'iran', 'russia', 'ukraine', 'taiwan', 'ceasefire', 'nuclear',
  // Finance
  'interest rate', 'federal reserve', 'inflation', 'recession', 'fed rate',
];

export interface EventMarket {
  conditionId: string;
  question: string;
  slug: string;
  endDate: string;
  liquidity: number;
  probability: number;    // 0-100
  category: Category;
  volume: number;
  yesTokenId: string;
  noTokenId: string;
}

async function fetchPage(offset: number, orderBy: string): Promise<any[]> {
  try {
    const resp = await axios.get(`${GAMMA_API}/markets`, {
      params: { active: true, limit: 100, offset, order: orderBy, ascending: false },
      timeout: 15000,
    });
    return Array.isArray(resp.data) ? resp.data : [];
  } catch {
    return [];
  }
}

export async function scanEventMarkets(): Promise<EventMarket[]> {
  try {
    // Fetch top 300 by liquidity + top 100 by volume for diversity
    const [page1, page2, page3, byVolume] = await Promise.all([
      fetchPage(0, 'liquidityNum'),
      fetchPage(100, 'liquidityNum'),
      fetchPage(200, 'liquidityNum'),
      fetchPage(0, 'volume'),
    ]);

    const allRaw = [...page1, ...page2, ...page3, ...byVolume];

    // Deduplicate by conditionId
    const seen = new Set<string>();
    const unique = allRaw.filter(m => {
      if (!m.conditionId || seen.has(m.conditionId)) return false;
      seen.add(m.conditionId);
      return true;
    });

    const results: EventMarket[] = [];

    for (const m of unique) {
      if (!m.question || !m.conditionId) continue;

      // Skip crypto 15m markets (Phase 1 handles these)
      if (m.slug && (m.slug.includes('updown') || m.slug.includes('15m') || m.slug.includes('5m'))) continue;

      // Minimum liquidity $500 (lowered from $1000 to catch match markets)
      const liquidity = parseFloat(m.liquidityNum ?? m.liquidity ?? '0');
      if (liquidity < 500) continue;

      // Must match at least one keyword
      const q = m.question.toLowerCase();
      if (!ALL_KEYWORDS.some(kw => q.includes(kw))) continue;

      // Parse probability from outcomePrices
      let probability = 50;
      if (m.outcomePrices) {
        try {
          const prices = JSON.parse(m.outcomePrices);
          probability = parseFloat(prices[0]) * 100;
        } catch { /* keep 50 */ }
      }

      // Parse YES/NO token IDs from clobTokenIds
      let yesTokenId = '';
      let noTokenId = '';
      if (m.clobTokenIds) {
        try {
          const ids = typeof m.clobTokenIds === 'string' ? JSON.parse(m.clobTokenIds) : m.clobTokenIds;
          yesTokenId = ids[0] ?? '';
          noTokenId = ids[1] ?? '';
        } catch { /* keep empty */ }
      }

      results.push({
        conditionId: m.conditionId,
        question: m.question,
        slug: m.slug ?? '',
        endDate: m.endDate ?? m.endDateIso ?? '',
        liquidity,
        probability,
        category: detectCategory(m.question),
        volume: parseFloat(m.volume ?? '0'),
        yesTokenId,
        noTokenId,
      });
    }

    // Sort by liquidity descending
    return results.sort((a, b) => b.liquidity - a.liquidity);
  } catch (err) {
    console.error('[Scanner] Failed:', (err as Error).message);
    return [];
  }
}
