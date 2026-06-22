import { fetchKalshiMarkets } from './kalshiApi';
import { detectCrossArbOpportunities, formatCrossArbAlert, CrossArbOpportunity } from './crossArbDetector';
import { scanEventMarkets } from '../phase2/marketScanner';
import { notify } from '../notifier';
import { store } from '../store';

// Scan every 10 minutes (offset from Phase 2's 15-minute cycle)
const SCAN_INTERVAL_MS = 10 * 60 * 1000;

// How many top opportunities to alert per cycle (avoid Telegram spam)
const MAX_ALERTS_PER_CYCLE = parseInt(process.env.KALSHI_MAX_ALERTS ?? '3', 10);

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Track which pairs were already alerted to avoid repeating every cycle
const alertedPairs = new Set<string>();
const ALERT_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours
const alertedAt: Record<string, number> = {};

function shouldAlert(opp: CrossArbOpportunity): boolean {
  const key = `${opp.kalshiTicker}:${opp.polyConditionId}`;
  const last = alertedAt[key] ?? 0;
  if (Date.now() - last < ALERT_COOLDOWN_MS) return false;
  alertedAt[key] = Date.now();
  return true;
}

async function runCrossArbCycle(simulate: boolean): Promise<void> {
  console.error('[Phase3] Scanning Kalshi × Polymarket...');

  // Fetch both platforms in parallel
  const [kalshiMarkets, polyMarkets] = await Promise.all([
    fetchKalshiMarkets(),
    scanEventMarkets(),
  ]);

  if (kalshiMarkets.length === 0) {
    console.error('[Phase3] Kalshi returned 0 markets — API may be down or geo-blocked. Skipping.');
    store.lastCrossArbScanAt = new Date().toISOString();
    return;
  }

  console.error(`[Phase3] Kalshi: ${kalshiMarkets.length} markets | Polymarket: ${polyMarkets.length} markets`);

  const opportunities = detectCrossArbOpportunities(kalshiMarkets, polyMarkets);

  // Store top 20 in dashboard
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
  store.lastCrossArbScanAt = new Date().toISOString();

  console.error(`[Phase3] ${opportunities.length} cross-arb opportunities found. Top divergence: ${
    opportunities[0]
      ? `${(Math.abs(opportunities[0].divergence) * 100).toFixed(1)}% (${opportunities[0].kalshiTicker})`
      : 'none'
  }`);

  // Alert top N new opportunities
  let alertsSent = 0;
  for (const opp of opportunities) {
    if (alertsSent >= MAX_ALERTS_PER_CYCLE) break;
    if (!shouldAlert(opp)) continue;

    const { subject, body } = formatCrossArbAlert(opp, simulate);
    await notify(subject, body);
    console.error(`[Phase3] Alerted: ${opp.polyQuestion.slice(0, 60)} | ${(opp.divergence * 100).toFixed(1)}%`);
    alertsSent++;
    await sleep(1500);
  }

  if (alertsSent === 0 && opportunities.length > 0) {
    console.error(`[Phase3] ${opportunities.length} opportunities found but all within cooldown window.`);
  }
}

export async function startPhase3(simulate: boolean): Promise<void> {
  // Wait 2 minutes before first scan (let Phase 1 & 2 stabilize)
  await sleep(2 * 60 * 1000);

  console.error('[Phase3] Starting — Cross-platform arbitrage: Kalshi × Polymarket');

  while (true) {
    try {
      await runCrossArbCycle(simulate);
    } catch (err) {
      console.error('[Phase3] Cycle error:', (err as Error).message);
    }
    await sleep(SCAN_INTERVAL_MS);
  }
}
