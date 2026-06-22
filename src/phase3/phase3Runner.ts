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

  // === DIAGNÓSTICO NOS PRIMEIROS 3 CICLOS OU SE NÃO ENCONTROU NADA ===
  if (cycleCount <= 3 || opportunities.length === 0) {
    const kalshiSample = kalshiMarkets.slice(0, 5).map((m, i) =>
      `  K${i+1}. ${m.title.slice(0, 60)} [${m.ticker}]`
    );
    const polySample = polyMarkets.slice(0, 5).map((m, i) =>
      `  P${i+1}. ${m.question.slice(0, 60)}`
    );
    const topMatches = opportunities.slice(0, 3).map((o, i) =>
      `  ${i+1}. Poly: "${o.polyQuestion.slice(0, 40)}"\n     Kalshi: "${o.kalshiTitle.slice(0, 40)}"\n     Div: ${(o.divergence*100).toFixed(1)}% | Match: ${(o.matchScore*100).toFixed(0)}% | Poly $${o.polyLiquidity.toFixed(0)}`
    );

    await notify(
      `🔀 Fase 3 — Ciclo #${cycleCount}: ${opportunities.length} oportunidades`,
      [
        `🔀 DIAGNÓSTICO FASE 3 — Ciclo #${cycleCount}`,
        ``,
        `✅ Kalshi: ${kalshiMarkets.length} mercados ativos`,
        `📊 Polymarket: ${polyMarkets.length} mercados escaneados`,
        `💡 Oportunidades encontradas: ${opportunities.length}`,
        ``,
        `📋 Amostra Kalshi (primeiros 5):`,
        kalshiSample.join('\n'),
        ``,
        `📋 Amostra Polymarket (top 5 liquidez):`,
        polySample.join('\n'),
        ``,
        opportunities.length > 0
          ? `🎯 Melhores pares:\n${topMatches.join('\n\n')}`
          : `⚪ Sem pares com divergência ≥ 5%, match ≥ 20% e liquidez ≥ $500`,
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
