import axios from 'axios';
import { config } from '../config';

export interface CryptoMarket {
  conditionId: string;
  question: string;
  slug: string;
  eventSlug: string;
  probability: number;   // 0-100
  liquidity: number;     // USD
  endDate: string;
  daysToEnd: number;
  clobTokenIds: string[]; // [yesTokenId, noTokenId]
}

const CRYPTO_KEYWORDS = [
  'bitcoin', 'btc', 'ethereum', 'eth', 'crypto', 'blockchain',
  'solana', 'sol', 'ripple', 'xrp', 'defi', 'altcoin',
  'cryptocurrency', 'coinbase', 'binance', 'token',
  'stablecoin', 'usdc', 'tether', 'dogecoin', 'doge',
  'cardano', 'ada', 'polygon', 'matic', 'avalanche', 'avax',
  'litecoin', 'ltc', 'chainlink', 'link', 'uniswap', 'uni',
  'shiba', 'pepe', 'memecoin', 'altseason', 'halving', 'etf',
  'spot etf', 'crypto market', 'digital asset', 'web3',
];

// Short tickers need word-boundary matching to avoid false positives
// e.g. 'eth' inside 'netherlands', 'sol' inside 'resolution'
const EXACT_TICKERS = new Set(['btc', 'eth', 'sol', 'xrp', 'ada', 'bnb', 'uni', 'link', 'nft']);

function isCrypto(question: string): boolean {
  const q = question.toLowerCase();
  for (const kw of CRYPTO_KEYWORDS) {
    if (EXACT_TICKERS.has(kw)) {
      // require word boundary: space/start/end/punctuation around ticker
      if (new RegExp(`(?<![a-z])${kw}(?![a-z])`).test(q)) return true;
    } else {
      if (q.includes(kw)) return true;
    }
  }
  return false;
}

function parseProb(m: any): number | null {
  if (Array.isArray(m.outcomePrices) && m.outcomePrices.length > 0) {
    const p = parseFloat(m.outcomePrices[0]);
    if (!isNaN(p) && p >= 0 && p <= 1) return p * 100;
    if (!isNaN(p) && p > 1) return p; // already 0-100
  }
  if (m.bestAsk != null) {
    const p = parseFloat(m.bestAsk);
    if (!isNaN(p) && p >= 0 && p <= 1) return p * 100;
  }
  return null;
}

export async function scanCryptoMarkets(): Promise<CryptoMarket[]> {
  const PAGE_SIZE = 100;
  const OFFSETS = [0, 100, 200, 300, 400]; // 5 páginas em paralelo = 500 mercados
  const all: any[] = [];

  try {
    const pages = await Promise.all(
      OFFSETS.map(offset =>
        axios.get(`${config.gammaApiUrl}/markets`, {
          params: { active: true, limit: PAGE_SIZE, offset },
          timeout: 12000,
        }).then(r => r.data ?? []).catch(() => [])
      )
    );
    for (const batch of pages) all.push(...batch);

    console.error(`[Phase2] Total de mercados recebidos da API: ${all.length}`);

    const now = Date.now();
    const markets: CryptoMarket[] = [];
    let filteredKeyword = 0, filteredProb = 0, filteredDays = 0;

    for (const m of all) {
      if (!m.question || !m.conditionId || !m.endDate) continue;

      if (!isCrypto(m.question)) { filteredKeyword++; continue; }

      const prob = parseProb(m);
      if (prob === null || prob < 3 || prob > 97) { filteredProb++; continue; }

      const endMs = new Date(m.endDate).getTime();
      const daysToEnd = (endMs - now) / 86400000;
      if (daysToEnd < 0.5 || daysToEnd > 365) { filteredDays++; continue; }

      const liquidity = parseFloat(m.liquidity ?? m.volume ?? '0') || 0;
      const clobTokenIds: string[] = Array.isArray(m.clobTokenIds) ? m.clobTokenIds : [];

      markets.push({
        conditionId: m.conditionId,
        question: m.question,
        slug: m.slug ?? '',
        eventSlug: m.events?.[0]?.slug ?? m.slug ?? '',
        probability: prob,
        liquidity,
        endDate: m.endDate,
        daysToEnd,
        clobTokenIds,
      });
    }

    console.error(
      `[Phase2] Filtros: keyword=${filteredKeyword} prob=${filteredProb} dias=${filteredDays} → ${markets.length} aprovados`
    );

    // Menor liquidez primeiro (mais ineficientes)
    markets.sort((a, b) => a.liquidity - b.liquidity);
    return markets.slice(0, 60);
  } catch (err) {
    console.error('[Phase2] Erro ao escanear mercados:', (err as Error).message);
    return [];
  }
}
