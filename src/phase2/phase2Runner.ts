import { scanEventMarkets } from './marketScanner';
import { fetchNews, detectCategory } from './newsCollector';
import { analyzeMarket } from './aiAnalyzer';
import { detectValueBet, formatValueBetEmail } from './valueBetDetector';
import { notify } from '../notifier';
import { addValueBet } from '../store';

const SCAN_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runScanCycle(simulate: boolean): Promise<void> {
  console.error('[Phase2] Scanning event markets...');

  const markets = await scanEventMarkets();
  console.error(`[Phase2] Found ${markets.length} event markets`);

  const alreadyAlerted = new Set<string>();
  let skippedDate = 0, skippedProb = 0, analyzed = 0, valueBetsFound = 0;

  for (const market of markets) {
    if (alreadyAlerted.has(market.conditionId)) continue;

    const daysToEnd = (new Date(market.endDate).getTime() - Date.now()) / 86400000;
    if (daysToEnd > 90 || daysToEnd < 0) { skippedDate++; continue; }

    if (market.probability > 92 || market.probability < 8) { skippedProb++; continue; }

    analyzed++;
    const category = detectCategory(market.question);
    const news = await fetchNews(category, market.question.slice(0, 60));

    const analysis = await analyzeMarket(market.question, market.probability, news);
    if (!analysis) continue;

    const valueBet = detectValueBet(market, analysis);
    if (!valueBet) continue;

    valueBetsFound++;
    alreadyAlerted.add(market.conditionId);
    addValueBet(valueBet);

    const { subject, body } = formatValueBetEmail(valueBet, simulate);
    await notify(subject, body);

    console.error(`[Phase2] VALUE BET: ${market.question.slice(0, 60)} | Edge: ${valueBet.edge.toFixed(1)}%`);

    await sleep(2000);
  }

  console.error(`[Phase2] Scan complete — analyzed:${analyzed} skipped(date):${skippedDate} skipped(prob):${skippedProb} valueBets:${valueBetsFound}. Next in 15min.`);
}

export async function startPhase2(simulate: boolean): Promise<void> {
  if (!process.env.DEEPSEEK_API_KEY) {
    console.error('[Phase2] DEEPSEEK_API_KEY not set — Phase 2 disabled.');
    return;
  }

  console.error('[Phase2] Starting — World Cup, Elections, Climate, Politics, Finance...');

  while (true) {
    try {
      await runScanCycle(simulate);
    } catch (err) {
      console.error('[Phase2] Cycle error:', (err as Error).message);
    }
    await sleep(SCAN_INTERVAL_MS);
  }
}
