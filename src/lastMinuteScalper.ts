import axios from 'axios';
import { getBestAsk, nextRoundEndMs, buyShares, createClobClient } from './api';
import { updatePrice, store } from './store';
import { notify } from './notifier';
import { config } from './config';

// ── Config ─────────────────────────────────────────────────────────────────
const BET_USDC       = parseFloat(process.env.SCALPER_BET_USDC  ?? '1');
const IMBALANCE_MIN  = parseFloat(process.env.IMBALANCE_MIN     ?? '0.30'); // entra quando um lado ≤ 30¢
const SCAN_MS        = parseInt  (process.env.SCALPER_SCAN_MS   ?? '10000', 10);
const MIN_SEC        = parseInt  (process.env.SCALPER_MIN_SEC   ?? '20',  10);
const ASSETS_5M: string[] = (process.env.SCALPER_ASSETS ?? 'btc,eth,sol,xrp,doge')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const ASSETS_15M: string[] = (process.env.MARKETS_15M ?? 'btc,eth,sol,xrp,doge')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function marketLink(market: any): string {
  const slug = market.events?.[0]?.slug ?? market.slug ?? '';
  return `https://polymarket.com/event/${slug}`;
}

// ── Market finders ─────────────────────────────────────────────────────────
async function findMarket(asset: string, minutes: 5 | 15): Promise<any | null> {
  try {
    const pattern = `${asset}-updown-${minutes}m`;
    const resp = await axios.get(`${config.gammaApiUrl}/markets`, {
      params: { active: true, limit: 300, order: 'createdAt', ascending: false },
      timeout: 10000,
    });
    const now = Date.now();
    const valid = (resp.data ?? []).filter((m: any) =>
      m.slug?.includes(pattern) && m.clobTokenIds && m.endDate &&
      new Date(m.endDate).getTime() > now + MIN_SEC * 1000
    );
    if (!valid.length) return null;
    valid.sort((a: any, b: any) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime());
    return valid[0];
  } catch { return null; }
}

// ── State ──────────────────────────────────────────────────────────────────
const enteredRounds = new Set<string>();

// ── Core logic: detecta e entra com hedge ─────────────────────────────────
async function scanAndEnter(
  asset: string,
  minutes: 5 | 15,
  simulate: boolean,
  client: ReturnType<typeof createClobClient>
): Promise<void> {
  const market = await findMarket(asset, minutes);
  if (!market) return;

  const endMs    = minutes === 5 ? nextRoundEndMs(5) : nextRoundEndMs(15);
  const secsLeft = (endMs - Date.now()) / 1000;
  if (secsLeft < MIN_SEC) return;

  let tokenIds: string[];
  try {
    tokenIds = typeof market.clobTokenIds === 'string'
      ? JSON.parse(market.clobTokenIds) : market.clobTokenIds;
  } catch { return; }
  const [upTokenId, downTokenId] = tokenIds;

  const [upAsk, downAsk] = await Promise.all([getBestAsk(upTokenId), getBestAsk(downTokenId)]);
  if (upAsk !== null) updatePrice(asset, 'up', upAsk);
  if (downAsk !== null) updatePrice(asset, 'down', downAsk);
  if (upAsk === null || downAsk === null) return;

  const combined = upAsk + downAsk;

  // Detecta desequilíbrio: um lado ≤ IMBALANCE_MIN (30¢ por padrão)
  const cheapSide  = upAsk <= IMBALANCE_MIN ? 'UP' : downAsk <= IMBALANCE_MIN ? 'DOWN' : null;
  if (!cheapSide) return; // mercado equilibrado, não entra

  const roundKey = `${market.conditionId}-${minutes}m`;
  if (enteredRounds.has(roundKey)) return;
  enteredRounds.add(roundKey);

  const cheapPrice = cheapSide === 'UP' ? upAsk : downAsk;
  const dearPrice  = cheapSide === 'UP' ? downAsk : upAsk;
  const cheapToken = cheapSide === 'UP' ? upTokenId : downTokenId;
  const dearToken  = cheapSide === 'UP' ? downTokenId : upTokenId;
  const multiplier = (1 / cheapPrice).toFixed(1);

  // Divide $1 ao meio: $0.50 no lado barato (loteria) + $0.50 no lado caro (hedge)
  const betCheap = BET_USDC * 0.50;
  const betDear  = BET_USDC * 0.50;
  const sharesCheap = Math.floor((betCheap / cheapPrice) * 10) / 10;
  const sharesDear  = Math.floor((betDear  / dearPrice)  * 10) / 10;

  // Cenários de resultado
  const ifCheapWins = (sharesCheap * 1).toFixed(2);
  const ifDearWins  = (sharesDear  * 1 - BET_USDC).toFixed(2);

  const mins = Math.floor(secsLeft / 60);
  const secs = Math.floor(secsLeft % 60);
  const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  const simLabel = simulate ? '🔔 [SINAL]' : '⚡ [EXECUTADO]';
  const label15  = minutes === 15 ? ' (15min)' : ' (5min)';

  console.error(
    `[Scalper][${asset}${label15}] HEDGE ${cheapSide} @ ${(cheapPrice*100).toFixed(0)}¢ | ` +
    `combined: ${(combined*100).toFixed(0)}¢ | ${timeStr} restantes`
  );

  // Executa ordens (ou simula)
  if (!simulate) {
    if (sharesCheap > 0) await buyShares(client, cheapToken, cheapPrice, sharesCheap, false);
    if (sharesDear  > 0) await buyShares(client, dearToken,  dearPrice,  sharesDear,  false);
  }

  // Store
  store.scalperTrades.unshift({
    asset: asset.toUpperCase(), side: cheapSide, entryPrice: cheapPrice,
    secsAtEntry: Math.round(secsLeft), betUsdc: BET_USDC,
    potentialProfit: parseFloat(ifCheapWins),
    simulate, timestamp: new Date().toISOString(),
    marketEndTime: market.endDate, settled: false, won: null, pnl: null,
  });
  if (store.scalperTrades.length > 100) store.scalperTrades.pop();

  await notify(
    `${simLabel} ${asset.toUpperCase()}${label15} HEDGE — ${cheapSide} a ${(cheapPrice*100).toFixed(0)}¢`,
    [
      `🎯 ENTRADA COM HEDGE — ${asset.toUpperCase()}${label15}`,
      ``,
      `📉 ${cheapSide} está em ${(cheapPrice*100).toFixed(0)}¢ (${multiplier}x potencial)`,
      `⏱ Tempo restante: ${timeStr}`,
      ``,
      `💰 $${BET_USDC.toFixed(2)} dividido em 2:`,
      `   $${betCheap.toFixed(2)} no lado ${cheapSide} (${(cheapPrice*100).toFixed(0)}¢) → ${sharesCheap} shares`,
      `   $${betDear.toFixed(2)} no lado ${cheapSide === 'UP' ? 'DOWN' : 'UP'} (${(dearPrice*100).toFixed(0)}¢) → ${sharesDear} shares`,
      ``,
      `   ✅ Se ${cheapSide} ganhar: +$${ifCheapWins}`,
      `   ⚠️ Se ${cheapSide === 'UP' ? 'DOWN' : 'UP'} ganhar: ${parseFloat(ifDearWins) >= 0 ? '+' : ''}$${ifDearWins}`,
      ``,
      `📊 Combinado: ${(combined*100).toFixed(0)}¢`,
      simulate ? `\n🔗 ${marketLink(market)}` : `\n✅ Ordens enviadas automaticamente.`,
    ].join('\n')
  );
}

// ── Entry point ────────────────────────────────────────────────────────────
export async function startLastMinuteScalper(simulate: boolean): Promise<void> {
  const client = createClobClient();
  console.error(
    `[Scalper] Iniciando — 5m: ${ASSETS_5M.join(',')} | 15m: ${ASSETS_15M.join(',')} | hedge quando ≤${IMBALANCE_MIN*100}¢`
  );

  setInterval(() => {
    if (enteredRounds.size > 1000) enteredRounds.clear();
  }, 60 * 60 * 1000);

  while (true) {
    const tasks = [
      ...ASSETS_5M.map(a  => scanAndEnter(a,  5,  simulate, client)),
      ...ASSETS_15M.map(a => scanAndEnter(a, 15, simulate, client)),
    ];
    await Promise.allSettled(tasks);
    await sleep(SCAN_MS);
  }
}
