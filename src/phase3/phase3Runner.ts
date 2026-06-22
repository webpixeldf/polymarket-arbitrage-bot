import { fetchKalshiMarkets } from './kalshiApi';
import { detectCrossArbOpportunities, formatCrossArbAlert, CrossArbOpportunity } from './crossArbDetector';
import { scanEventMarkets } from '../phase2/marketScanner';
import { notify } from '../notifier';
import { store } from '../store';

const SCAN_INTERVAL_MS = 10 * 60 * 1000;
const MAX_ALERTS_PER_CYCLE = parseInt(process.env.KALSHI_MAX_ALERTS ?? '3', 10);
const ALERT_COOLDOWN_MS = 4 * 60 * 60 * 1000;

let cycleCount = 0;
const alertedAt: Record<string, number> = {};

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function shouldAlert(opp: CrossArbOpportunity): boolean {
  const key = `${opp.kalshiTicker}:${opp.polyConditionId}`;
  const last = alertedAt[key] ?? 0;
  if (Date.now() - last < ALERT_COOLDOWN_MS) return false;
  alertedAt[key] = Date.now();
  return true;
}

async function runCrossArbCycle(simulate: boolean): Promise<void> {
  cycleCount++;
  console.error(`[Phase3] Ciclo #${cycleCount} — Kalshi × Polymarket`);

  const [kalshiMarkets, polyMarkets] = await Promise.all([
    fetchKalshiMarkets(),
    scanEventMarkets(),
  ]);

  store.lastCrossArbScanAt = new Date().toISOString();

  // === KALSHI INDISPONÍVEL ===
  if (kalshiMarkets.length === 0) {
    console.error('[Phase3] Kalshi retornou 0 mercados — API offline ou bloqueada por IP.');
    await notify(
      `⚠️ Fase 3 — Ciclo #${cycleCount}: Kalshi indisponível`,
      [
        `🔀 DIAGNÓSTICO FASE 3 — Ciclo #${cycleCount}`,
        ``,
        `❌ Kalshi: 0 mercados retornados`,
        `   A API pode estar offline ou bloqueada por IP do servidor.`,
        ``,
        `📊 Polymarket: ${polyMarkets.length} mercados escaneados`,
        ``,
        `Próxima tentativa em 10 minutos.`,
      ].join('\n')
    );
    return;
  }

  const opportunities = detectCrossArbOpportunities(kalshiMarkets, polyMarkets);

  store.crossArbOpportunities = opportunities.slice(0, 20).map(opp => ({
    kalshiTicker: opp.kalshiTicker,
    kalshiTitle: opp.kalshiTitle,
    kalshiProb: opp.kalshiProb,
    polyQuestion: opp.polyQuestion,
    polyEventSlug: opp.polyEventSlug,
    polyProb: opp.polyProb,
    divergence: opp.divergence,
    recommendation: opp.recommendation,
    matchScore: opp.matchScore,
    polyLiquidity: opp.polyLiquidity,
    timestamp: opp.timestamp,
  }));

  console.error(
    `[Phase3] Kalshi: ${kalshiMarkets.length} | Poly: ${polyMarkets.length} | Oportunidades: ${opportunities.length}`
  );

  // === DIAGNÓSTICO NOS PRIMEIROS 2 CICLOS OU SE NÃO ENCONTROU NADA ===
  if (cycleCount <= 2 || opportunities.length === 0) {
    const topThree = opportunities.slice(0, 3).map((o, i) =>
      `  ${i + 1}. ${o.polyQuestion.slice(0, 50)}\n     Poly: ${(o.polyProb*100).toFixed(1)}% | Kalshi: ${(o.kalshiProb*100).toFixed(1)}% | Div: ${(o.divergence*100).toFixed(1)}% | Match: ${(o.matchScore*100).toFixed(0)}%`
    );

    await notify(
      `🔀 Fase 3 — Ciclo #${cycleCount}: ${opportunities.length} oportunidades`,
      [
        `🔀 DIAGNÓSTICO FASE 3 — Ciclo #${cycleCount}`,
        ``,
        `✅ Kalshi: ${kalshiMarkets.length} mercados ativos`,
        `📊 Polymarket: ${polyMarkets.length} mercados escaneados`,
        `💡 Pares com divergência ≥ limiar: ${opportunities.length}`,
        ``,
        opportunities.length > 0
          ? `📋 Melhores pares encontrados:\n${topThree.join('\n\n')}`
          : `⚪ Nenhum par encontrou divergência ≥ ${process.env.KALSHI_MIN_DIVERGENCE ? (parseFloat(process.env.KALSHI_MIN_DIVERGENCE)*100).toFixed(0) : '7'}% com match ≥ ${process.env.KALSHI_MIN_MATCH ? (parseFloat(process.env.KALSHI_MIN_MATCH)*100).toFixed(0) : '30'}% e liquidez ≥ $${process.env.KALSHI_MIN_LIQUIDITY ?? '2000'}`,
        ``,
        `Próximo ciclo em 10 minutos.`,
      ].join('\n')
    );
  }

  // === ALERTAS DE OPORTUNIDADE ===
  let alertsSent = 0;
  for (const opp of opportunities) {
    if (alertsSent >= MAX_ALERTS_PER_CYCLE) break;
    if (!shouldAlert(opp)) continue;

    const { subject, body } = formatCrossArbAlert(opp, simulate);
    await notify(subject, body);
    console.error(`[Phase3] Alerta enviado: ${opp.polyQuestion.slice(0, 60)} | Div: ${(opp.divergence*100).toFixed(1)}%`);
    alertsSent++;
    await sleep(1500);
  }
}

export async function startPhase3(simulate: boolean): Promise<void> {
  await sleep(2 * 60 * 1000);
  console.error('[Phase3] Iniciando — Cross-platform arbitrage: Kalshi × Polymarket');

  while (true) {
    try {
      await runCrossArbCycle(simulate);
    } catch (err) {
      console.error('[Phase3] Erro no ciclo:', (err as Error).message);
      await notify(
        '❌ Fase 3 — Erro no ciclo',
        `Erro: ${(err as Error).message}\n\nPróxima tentativa em 10 minutos.`
      );
    }
    await sleep(SCAN_INTERVAL_MS);
  }
}
