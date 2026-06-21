import { scanEventMarkets } from './marketScanner';
import { fetchNews, detectCategory } from './newsCollector';
import { analyzeMarket } from './aiAnalyzer';
import { detectValueBet, formatValueBetEmail, ValueBet } from './valueBetDetector';
import { notify } from '../notifier';
import { addValueBet } from '../store';

const SCAN_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runScanCycle(simulate: boolean): Promise<void> {
  console.error('[Phase2] Scanning event markets...');

  const markets = await scanEventMarkets();
  console.error(`[Phase2] Found ${markets.length} event markets (World Cup, Elections, Climate)`);

  const alreadyAlerted = new Set<string>();

  for (const market of markets) {
    if (alreadyAlerted.has(market.conditionId)) continue;

    // Skip markets too far out (> 90 days)
    const daysToEnd = (new Date(market.endDate).getTime() - Date.now()) / 86400000;
    if (daysToEnd > 90 || daysToEnd < 0) continue;

    // Skip markets where probability is already very extreme (> 90% or < 10%)
    if (market.probability > 92 || market.probability < 8) continue;

    const category = detectCategory(market.question);
    const news = await fetchNews(category, market.question.slice(0, 60));

    const analysis = await analyzeMarket(market.question, market.probability, news);
    if (!analysis) continue;

    const valueBet = detectValueBet(market, analysis);
    if (!valueBet) continue;

    alreadyAlerted.add(market.conditionId);
    addValueBet(valueBet);

    const { subject, body } = formatValueBetEmail(valueBet, simulate);
    await notify(subject, body);

    console.error(`[Phase2] VALUE BET: ${market.question.slice(0, 60)} | Edge: ${valueBet.edge.toFixed(1)}%`);

    // Rate limit: wait 3s between AI calls
    await sleep(3000);
  }

  console.error(`[Phase2] Scan complete. Next scan in 15 minutes.`);
}

export async function startPhase2(simulate: boolean): Promise<void> {
  if (!process.env.DEEPSEEK_API_KEY) {
    console.error('[Phase2] DEEPSEEK_API_KEY not set — Phase 2 disabled.');
    return;
  }

  console.error('[Phase2] Starting event market scanner (World Cup, Elections, Climate)...');

  while (true) {
    try {
      await runScanCycle(simulate);
    } catch (err) {
      console.error('[Phase2] Cycle error:', (err as Error).message);
    }
    await sleep(SCAN_INTERVAL_MS);
  }
}
