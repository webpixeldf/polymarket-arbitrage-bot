import { EventMarket } from './marketScanner';
import { AIAnalysis } from './aiAnalyzer';
import { Category } from './newsCollector';

const MIN_EDGE = parseFloat(process.env.MIN_EDGE ?? '8');
const MIN_CONFIDENCE = parseFloat(process.env.MIN_CONFIDENCE ?? '70');
const MIN_LIQUIDITY = parseFloat(process.env.MIN_LIQUIDITY ?? '1000');

export interface ValueBet {
  market: EventMarket;
  analysis: AIAnalysis;
  edge: number;           // AI probability - Market probability
  recommendation: 'BUY_YES' | 'BUY_NO';
  expectedValue: number;  // estimated profit %
  timestamp: string;
  category: Category;
}

export function detectValueBet(
  market: EventMarket,
  analysis: AIAnalysis
): ValueBet | null {
  if (market.liquidity < MIN_LIQUIDITY) return null;
  if (analysis.confidence < MIN_CONFIDENCE) return null;

  const edge = analysis.probability - market.probability;
  const absEdge = Math.abs(edge);

  if (absEdge < MIN_EDGE) return null;

  const recommendation = edge > 0 ? 'BUY_YES' : 'BUY_NO';

  // Expected value = edge / 100 (simplified)
  const expectedValue = absEdge;

  return {
    market,
    analysis,
    edge,
    recommendation,
    expectedValue,
    timestamp: new Date().toISOString(),
    category: market.category,
  };
}

export function formatValueBetEmail(vb: ValueBet, simulate: boolean): { subject: string; body: string } {
  const simLabel = simulate ? '[SIMULAÇÃO] ' : '';
  const categoryEmoji: Record<string, string> = {
    worldcup: '⚽',
    elections: '🗳️',
    climate: '🌪️',
    politics: '🏛️',
    finance: '💹',
    geopolitics: '🌍',
    sports: '🏆',
    tech: '🤖',
    general: '📊',
  };
  const emoji = categoryEmoji[vb.category];

  const subject = `${simLabel}${emoji} VALUE BET — Edge ${vb.edge > 0 ? '+' : ''}${vb.edge.toFixed(1)}% | ${vb.market.question.slice(0, 60)}`;

  const body = [
    `${emoji} OPORTUNIDADE DETECTADA`,
    ``,
    `Pergunta: ${vb.market.question}`,
    ``,
    `📊 Probabilidade do mercado: ${vb.market.probability.toFixed(1)}%`,
    `🤖 Probabilidade estimada (DeepSeek): ${vb.analysis.probability.toFixed(1)}%`,
    `📈 Edge: ${vb.edge > 0 ? '+' : ''}${vb.edge.toFixed(1)}%`,
    `💡 Confiança da IA: ${vb.analysis.confidence.toFixed(0)}%`,
    ``,
    `✅ RECOMENDAÇÃO: ${vb.recommendation === 'BUY_YES' ? 'COMPRAR SIM (YES)' : 'COMPRAR NÃO (NO)'}`,
    `💰 Lucro esperado: ~${vb.expectedValue.toFixed(1)}%`,
    `💧 Liquidez: $${vb.market.liquidity.toFixed(0)}`,
    ``,
    `🧠 Análise da IA:`,
    vb.analysis.reasoning,
    ``,
    `✅ Fatores positivos:`,
    ...vb.analysis.bullishFactors.map(f => `  • ${f}`),
    ``,
    `❌ Fatores negativos:`,
    ...vb.analysis.bearishFactors.map(f => `  • ${f}`),
    ``,
    `🔗 Mercado: https://polymarket.com/event/${vb.market.slug}`,
    ``,
    simulate ? '⚠️ MODO SIMULAÇÃO — nenhuma ordem foi executada.' : '✅ Alerta para operação manual.',
  ].join('\n');

  return { subject, body };
}
