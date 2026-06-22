import { ManifoldMarket } from './manifoldApi';
import { EventMarket } from '../phase2/marketScanner';

const MIN_DIVERGENCE = parseFloat(process.env.KALSHI_MIN_DIVERGENCE ?? '0.05');   // 5%
const MIN_MATCH_SCORE = parseFloat(process.env.KALSHI_MIN_MATCH ?? '0.20');        // 20%
const MIN_POLY_LIQUIDITY = parseFloat(process.env.KALSHI_MIN_LIQUIDITY ?? '500'); // $500

export interface CrossArbOpportunity {
  refId: string;
  refTitle: string;
  refUrl: string;
  refProb: number;          // 0-1
  refLiquidity: number;
  polyConditionId: string;
  polyQuestion: string;
  polyEventSlug: string;
  polyProb: number;         // 0-1
  divergence: number;       // refProb - polyProb (positive = poly underprices YES)
  recommendation: 'BUY_YES' | 'BUY_NO';
  matchScore: number;       // 0-1
  polyLiquidity: number;
  timestamp: string;
}

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

function matchScore(refTitle: string, polyQuestion: string): number {
  const rSet = new Set(tokenize(refTitle));
  const pTokens = tokenize(polyQuestion);
  if (rSet.size === 0 || pTokens.length === 0) return 0;
  let overlap = 0;
  for (const t of pTokens) {
    if (rSet.has(t)) overlap++;
  }
  const union = new Set([...rSet, ...pTokens]).size;
  return union > 0 ? overlap / union : 0;
}

export function detectCrossArbOpportunities(
  refMarkets: ManifoldMarket[],
  polyMarkets: EventMarket[]
): CrossArbOpportunity[] {
  const results: CrossArbOpportunity[] = [];
  const seen = new Set<string>();

  for (const rm of refMarkets) {
    if (rm.probability < 0.01 || rm.probability > 0.99) continue;

    let bestMatch: EventMarket | null = null;
    let bestScore = 0;

    for (const pm of polyMarkets) {
      const score = matchScore(rm.question, pm.question);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = pm;
      }
    }

    if (!bestMatch || bestScore < MIN_MATCH_SCORE) continue;
    if (bestMatch.liquidity < MIN_POLY_LIQUIDITY) continue;

    const polyProb = bestMatch.probability / 100;
    const divergence = rm.probability - polyProb;

    if (Math.abs(divergence) < MIN_DIVERGENCE) continue;

    const pairKey = `${rm.id}:${bestMatch.conditionId}`;
    if (seen.has(pairKey)) continue;
    seen.add(pairKey);

    results.push({
      refId: rm.id,
      refTitle: rm.question,
      refUrl: rm.url,
      refProb: rm.probability,
      refLiquidity: rm.totalLiquidity,
      polyConditionId: bestMatch.conditionId,
      polyQuestion: bestMatch.question,
      polyEventSlug: bestMatch.eventSlug,
      polyProb,
      divergence,
      recommendation: divergence > 0 ? 'BUY_YES' : 'BUY_NO',
      matchScore: bestScore,
      polyLiquidity: bestMatch.liquidity,
      timestamp: new Date().toISOString(),
    });
  }

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
    `🔀 ARBITRAGEM CROSS-PLATFORM (Manifold × Polymarket)`,
    ``,
    `📊 Polymarket:`,
    `   "${opp.polyQuestion}"`,
    `   Probabilidade: ${(opp.polyProb * 100).toFixed(1)}%`,
    `   Liquidez: $${opp.polyLiquidity.toFixed(0)}`,
    ``,
    `📊 Manifold (referência comunitária):`,
    `   "${opp.refTitle}"`,
    `   Probabilidade: ${(opp.refProb * 100).toFixed(1)}%`,
    `   Liquidez Manifold: M$${opp.refLiquidity.toFixed(0)}`,
    ``,
    `⚡ Divergência: ${opp.divergence > 0 ? '+' : ''}${(opp.divergence * 100).toFixed(1)}%`,
    `🎯 Similaridade dos mercados: ${(opp.matchScore * 100).toFixed(0)}%`,
    ``,
    `✅ RECOMENDAÇÃO: ${direction} no Polymarket`,
    `💡 Manifold precifica ${(opp.refProb * 100).toFixed(1)}% — Polymarket está ${underOver} em ${absDiv}%.`,
    ``,
    `🔗 Polymarket: https://polymarket.com/event/${opp.polyEventSlug}`,
    `🔗 Manifold:   ${opp.refUrl}`,
    ``,
    simulate ? '⚠️ Execute manualmente no Polymarket.' : '✅ Execute manualmente no Polymarket.',
  ].join('\n');

  return { subject, body };
}
