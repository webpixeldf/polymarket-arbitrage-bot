import { fetchManifoldMarkets } from './manifoldApi';
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
  const key = `${opp.refId}:${opp.polyConditionId}`;
  const last = alertedAt[key] ?? 0;
  if (Date.now() - last < ALERT_COOLDOWN_MS) return false;
  alertedAt[key] = Date.now();
  return true;
}

async function runCrossArbCycle(simulate: boolean): Promise<void> {
  cycleCount++;
  console.error(`[Phase3] Ciclo #${cycleCount} — Manifold × Polymarket`);

  const [refMarkets, polyMarkets] = await Promise.all([
    fetchManifoldMarkets(),
    scanEventMarkets(),
  ]);

  store.lastCrossArbScanAt = new Date().toISOString();

  if (refMarkets.length === 0) {
    console.error('[Phase3] Manifold retornou 0 mercados.');
    await notify(
      `⚠️ Fase 3 — Ciclo #${cycleCount}: Manifold indisponível`,
      `❌ Manifold API retornou 0 mercados.\nPolymarket: ${polyMarkets.length} mercados escaneados.\nPróxima tentativa em 10 minutos.`
    );
    return;
  }

  const opportunities = detectCrossArbOpportunities(refMarkets, polyMarkets);

  store.crossArbOpportunities = opportunities.slice(0, 20).map(opp => ({
    kalshiTicker: opp.refId,
    kalshiTitle: opp.refTitle,
    kalshiProb: opp.refProb,
    polyQuestion: opp.polyQuestion,
    polyEventSlug: opp.polyEventSlug,
    polyProb: opp.polyProb,
    divergence: opp.divergence,
    recommendation: opp.recommendation,
    matchScore: opp.matchScore,
    polyLiquidity: opp.polyLiquidity,
    timestamp: opp.timestamp,
  }));

  console.error(`[Phase3] Manifold: ${refMarkets.length} | Poly: ${polyMarkets.length} | Oportunidades: ${opportunities.length}`);

  // Diagnóstico nos primeiros 3 ciclos ou quando não encontra nada
  if (cycleCount <= 3 || opportunities.length === 0) {
    const refSample = refMarkets.slice(0, 5).map((m, i) =>
      `  M${i+1}. ${m.question.slice(0, 65)} [${(m.probability*100).toFixed(0)}%]`
    );
    const polySample = polyMarkets.slice(0, 5).map((m, i) =>
      `  P${i+1}. ${m.question.slice(0, 65)} [${m.probability.toFixed(0)}%]`
    );
    const topMatches = opportunities.slice(0, 3).map((o, i) =>
      `  ${i+1}. "${o.polyQuestion.slice(0, 45)}"\n     Manifold: ${(o.refProb*100).toFixed(1)}% | Poly: ${(o.polyProb*100).toFixed(1)}% | Div: ${(o.divergence*100).toFixed(1)}% | Match: ${(o.matchScore*100).toFixed(0)}%`
    );

    await notify(
      `🔀 Fase 3 — Ciclo #${cycleCount}: ${opportunities.length} oportunidades (Manifold × Poly)`,
      [
        `🔀 DIAGNÓSTICO FASE 3 — Ciclo #${cycleCount}`,
        ``,
        `✅ Manifold: ${refMarkets.length} mercados ativos`,
        `📊 Polymarket: ${polyMarkets.length} mercados escaneados`,
        `💡 Oportunidades encontradas: ${opportunities.length}`,
        ``,
        `📋 Amostra Manifold (top 5 liquidez):`,
        refSample.join('\n'),
        ``,
        `📋 Amostra Polymarket (top 5):`,
        polySample.join('\n'),
        ``,
        opportunities.length > 0
          ? `🎯 Melhores pares:\n${topMatches.join('\n\n')}`
          : `⚪ Sem pares com divergência ≥ 5%, similaridade ≥ 20% e liquidez ≥ $500`,
        ``,
        `Próximo ciclo em 10 minutos.`,
      ].join('\n')
    );
  }

  let alertsSent = 0;
  for (const opp of opportunities) {
    if (alertsSent >= MAX_ALERTS_PER_CYCLE) break;
    if (!shouldAlert(opp)) continue;
    const { subject, body } = formatCrossArbAlert(opp, simulate);
    await notify(subject, body);
    console.error(`[Phase3] Alerta: ${opp.polyQuestion.slice(0, 60)} | Div: ${(opp.divergence*100).toFixed(1)}%`);
    alertsSent++;
    await sleep(1500);
  }
}

export async function startPhase3(simulate: boolean): Promise<void> {
  await sleep(2 * 60 * 1000);
  console.error('[Phase3] Iniciando — Cross-platform arbitrage: Manifold × Polymarket');

  while (true) {
    try {
      await runCrossArbCycle(simulate);
    } catch (err) {
      console.error('[Phase3] Erro:', (err as Error).message);
      await notify('❌ Fase 3 — Erro', `${(err as Error).message}\n\nPróxima tentativa em 10 minutos.`);
    }
    await sleep(SCAN_INTERVAL_MS);
  }
}
