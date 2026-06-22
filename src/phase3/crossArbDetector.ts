import { KalshiMarket, kalshiYesPrice } from './kalshiApi';
import { EventMarket } from '../phase2/marketScanner';

// Minimum price divergence to flag (e.g. 0.07 = 7%)
const MIN_DIVERGENCE = parseFloat(process.env.KALSHI_MIN_DIVERGENCE ?? '0.07');

// Minimum keyword overlap score to consider markets as matching (0-1)
const MIN_MATCH_SCORE = parseFloat(process.env.KALSHI_MIN_MATCH ?? '0.30');

// Minimum Polymarket liquidity ($) to be worth trading
const MIN_POLY_LIQUIDITY = parseFloat(process.env.KALSHI_MIN_LIQUIDITY ?? '2000');

export interface CrossArbOpportunity {
  kalshiTicker: string;
  kalshiTitle: string;
  kalshiProb: number;          // 0-1
  polyConditionId: string;
  polyQuestion: string;
  polyEventSlug: string;
  polyProb: number;            // 0-1
  divergence: number;          // kalshiProb - polyProb (positive = poly underprices YES)
  recommendation: 'BUY_YES' | 'BUY_NO';
  matchScore: number;          // 0-1 keyword similarity
  polyLiquidity: number;
  kalshiVolume24h: number;
  timestamp: string;
}

// Words too generic to help with matching
const STOP_WORDS = new Set([
  'will', 'the', 'a', 'an', 'be', 'is', 'are', 'was', 'were', 'has', 'have',
  'in', 'on', 'at', 'to', 'for', 'of', 'and', 'or', 'not', 'no', 'yes',
  'does', 'do', 'by', 'from', 'with', 'above', 'below', 'after', 'before',
  'than', 'this', 'that', 'over', 'under', 'end', 'close', 'year', 'month',
  'day', 'week', 'least', 'most', 'its', 'his', 'her', 'their', 'our',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9%$.]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

// Jaccard-like similarity between two market titles
function matchScore(kalshiTitle: string, polyQuestion: string): number {
  const kSet = new Set(tokenize(kalshiTitle));
  const pTokens = tokenize(polyQuestion);

  if (kSet.size === 0 || pTokens.length === 0) return 0;

  let overlap = 0;
  for (const t of pTokens) {
    if (kSet.has(t)) overlap++;
  }

  const union = new Set([...kSet, ...pTokens]).size;
  return union > 0 ? overlap / union : 0;
}

export function detectCrossArbOpportunities(
  kalshiMarkets: KalshiMarket[],
  polyMarkets: EventMarket[]
): CrossArbOpportunity[] {
  const results: CrossArbOpportunity[] = [];
  const seen = new Set<string>(); // deduplicate by kalshi+poly pair

  for (const km of kalshiMarkets) {
    const kalshiProb = kalshiYesPrice(km);

    // Skip if no valid price
    if (kalshiProb < 0.01 || kalshiProb > 0.99) continue;
    // Skip illiquid Kalshi markets
    if ((km.volume_24h ?? 0) < 100) continue;

    // Find best matching Polymarket
    let bestMatch: EventMarket | null = null;
    let bestScore = 0;

    for (const pm of polyMarkets) {
      const score = matchScore(km.title, pm.question);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = pm;
      }
    }

    if (!bestMatch || bestScore < MIN_MATCH_SCORE) continue;
    if (bestMatch.liquidity < MIN_POLY_LIQUIDITY) continue;

    const polyProb = bestMatch.probability / 100;
    const divergence = kalshiProb - polyProb;

    if (Math.abs(divergence) < MIN_DIVERGENCE) continue;

    const pairKey = `${km.ticker}:${bestMatch.conditionId}`;
    if (seen.has(pairKey)) continue;
    seen.add(pairKey);

    results.push({
      kalshiTicker: km.ticker,
      kalshiTitle: km.title,
      kalshiProb,
      polyConditionId: bestMatch.conditionId,
      polyQuestion: bestMatch.question,
      polyEventSlug: bestMatch.eventSlug,
      polyProb,
      divergence,
      recommendation: divergence > 0 ? 'BUY_YES' : 'BUY_NO',
      matchScore: bestScore,
      polyLiquidity: bestMatch.liquidity,
      kalshiVolume24h: km.volume_24h ?? 0,
      timestamp: new Date().toISOString(),
    });
  }

  // Sort by absolute divergence descending
  return results.sort((a, b) => Math.abs(b.divergence) - Math.abs(a.divergence));
}

export function formatCrossArbAlert(opp: CrossArbOpportunity, simulate: boolean): {
  subject: string;
  body: string;
} {
  const simLabel = simulate ? '[SIMULAÇÃO] ' : '';
  const absDiv = (Math.abs(opp.divergence) * 100).toFixed(1);
  const direction = opp.recommendation === 'BUY_YES' ? '📈 COMPRAR YES' : '📉 COMPRAR NO';
  const underOver = opp.divergence > 0 ? 'subavaliando (barato)' : 'superavaliando (caro)';

  const subject = `${simLabel}🔀 CROSS-ARB ${absDiv}% — ${opp.polyQuestion.slice(0, 55)}`;

  const body = [
    `🔀 ARBITRAGEM CROSS-PLATFORM (Kalshi × Polymarket)`,
    ``,
    `📊 Polymarket:`,
    `   "${opp.polyQuestion}"`,
    `   Probabilidade: ${(opp.polyProb * 100).toFixed(1)}%`,
    `   Liquidez: $${opp.polyLiquidity.toFixed(0)}`,
    ``,
    `📊 Kalshi (sinal de referência):`,
    `   "${opp.kalshiTitle}"`,
    `   Ticker: ${opp.kalshiTicker}`,
    `   Probabilidade: ${(opp.kalshiProb * 100).toFixed(1)}%`,
    `   Volume 24h: $${opp.kalshiVolume24h.toFixed(0)}`,
    ``,
    `⚡ Divergência: ${opp.divergence > 0 ? '+' : ''}${(opp.divergence * 100).toFixed(1)}%`,
    `🎯 Similaridade dos mercados: ${(opp.matchScore * 100).toFixed(0)}%`,
    ``,
    `✅ RECOMENDAÇÃO: ${direction} no Polymarket`,
    `💡 Kalshi (mercado mais eficiente) precifica ${(opp.kalshiProb * 100).toFixed(1)}%`,
    `   Polymarket está ${underOver} este evento em ${absDiv}%.`,
    ``,
    `🔗 Polymarket: https://polymarket.com/event/${opp.polyEventSlug}`,
    `🔗 Kalshi:     https://kalshi.com/markets/${opp.kalshiTicker}`,
    ``,
    simulate ? '⚠️ MODO SIMULAÇÃO — verifique e execute manualmente.' : '✅ Execute manualmente no Polymarket.',
  ].join('\n');

  return { subject, body };
}
