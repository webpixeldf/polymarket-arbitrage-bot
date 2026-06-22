import axios from 'axios';
import { getBestAsk } from './api';
import { notify } from './notifier';
import { store } from './store';
import { config } from './config';

// ── Config ─────────────────────────────────────────────────────────────────
const ENTRY_MIN   = parseFloat(process.env.SCALPER_MIN_PRICE     ?? '0.80'); // 80¢ mínimo
const ENTRY_MAX   = parseFloat(process.env.SCALPER_MAX_PRICE     ?? '0.93'); // 93¢ máximo
const BET_USDC    = parseFloat(process.env.SCALPER_BET_USDC      ?? '2');    // $ por trade
const WINDOW_SEC  = parseInt  (process.env.SCALPER_WINDOW_SEC    ?? '90', 10); // janela de entrada
const MIN_SEC     = parseInt  (process.env.SCALPER_MIN_SEC       ?? '25', 10); // mínimo para entrar
const SCAN_MS     = parseInt  (process.env.SCALPER_SCAN_MS       ?? '12000', 10); // intervalo de scan
const ASSETS: string[] = (process.env.SCALPER_ASSETS ?? '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Market finder ──────────────────────────────────────────────────────────
async function findNext5mMarket(asset: string): Promise<any | null> {
  try {
    const slugPattern = `${asset}-updown-5m`;
    const resp = await axios.get(`${config.gammaApiUrl}/markets`, {
      params: { active: true, limit: 300, order: 'createdAt', ascending: false },
      timeout: 10000,
    });
    const markets: any[] = resp.data ?? [];
    const now = Date.now();
    const valid = markets.filter(m =>
      m.slug?.includes(slugPattern) &&
      m.clobTokenIds && m.endDate &&
      new Date(m.endDate).getTime() > now + MIN_SEC * 1000
    );
    if (!valid.length) return null;
    valid.sort((a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime());
    return valid[0];
  } catch {
    return null;
  }
}

// ── State ──────────────────────────────────────────────────────────────────
// Tracks markets we already entered this session
const enteredMarkets = new Set<string>();

// ── Settlement checker ─────────────────────────────────────────────────────
async function settleScalperTrade(params: {
  tokenId: string;
  asset: string;
  side: 'UP' | 'DOWN';
  entryPrice: number;
  simulate: boolean;
  tradeTimestamp: string;
}): Promise<void> {
  const { tokenId, asset, side, entryPrice, simulate, tradeTimestamp } = params;

  // Poll price after settlement — winning token → 1.00, losing → 0.00
  await sleep(5000);
  const finalPrice = await getBestAsk(tokenId);
  const won = finalPrice !== null && finalPrice >= 0.95;

  const profitPct = (1 / entryPrice - 1) * 100;
  const pnl = won
    ? parseFloat((profitPct / 100 * BET_USDC).toFixed(2))
    : -BET_USDC;

  // Update trade record
  const trade = store.scalperTrades.find(
    t => !t.settled && t.timestamp === tradeTimestamp
  );
  if (trade) {
    trade.settled = true;
    trade.won = won;
    trade.pnl = pnl;
    if (won) store.scalperProfit += pnl;
    else store.scalperProfit -= BET_USDC;
  }

  console.error(
    `[Scalper][${asset}] Resultado: ${won ? '✅ GANHOU' : '❌ PERDEU'} | PnL: ${pnl > 0 ? '+' : ''}$${pnl.toFixed(2)}`
  );

  const simLabel = simulate ? '[SIMULAÇÃO] ' : '';
  await notify(
    `${simLabel}⚡ Scalper ${asset} ${side}: ${won ? '✅ GANHOU' : '❌ PERDEU'}`,
    [
      `⚡ RESULTADO — LAST MINUTE SCALPER`,
      ``,
      `Ativo: ${asset}`,
      `Lado: ${side}`,
      `Entrada: ${(entryPrice * 100).toFixed(1)}¢`,
      ``,
      won
        ? `✅ GANHOU! P&L: +$${pnl.toFixed(2)} (+${profitPct.toFixed(1)}%)`
        : `❌ PERDEU. P&L: -$${BET_USDC.toFixed(2)}`,
      ``,
      `💰 Lucro acumulado scalper: ${store.scalperProfit >= 0 ? '+' : ''}$${store.scalperProfit.toFixed(2)}`,
    ].join('\n')
  );
}

// ── Main scan cycle ────────────────────────────────────────────────────────
async function scanAsset(asset: string, simulate: boolean): Promise<void> {
  const market = await findNext5mMarket(asset);
  if (!market) return;

  const endMs  = new Date(market.endDate).getTime();
  const secsLeft = (endMs - Date.now()) / 1000;

  // Only enter in the entry window
  if (secsLeft > WINDOW_SEC || secsLeft < MIN_SEC) return;

  // Skip if already entered this round
  if (enteredMarkets.has(market.conditionId)) return;

  // Parse token IDs
  let tokenIds: string[];
  try {
    tokenIds = typeof market.clobTokenIds === 'string'
      ? JSON.parse(market.clobTokenIds)
      : market.clobTokenIds;
  } catch { return; }
  const [upTokenId, downTokenId] = tokenIds;

  // Get prices
  const [upAsk, downAsk] = await Promise.all([
    getBestAsk(upTokenId),
    getBestAsk(downTokenId),
  ]);
  if (upAsk === null || downAsk === null) return;

  // Find which side is in entry range
  let side: 'UP' | 'DOWN' | null = null;
  let entryPrice = 0;
  let tokenId = '';

  if (upAsk >= ENTRY_MIN && upAsk <= ENTRY_MAX) {
    side = 'UP'; entryPrice = upAsk; tokenId = upTokenId;
  } else if (downAsk >= ENTRY_MIN && downAsk <= ENTRY_MAX) {
    side = 'DOWN'; entryPrice = downAsk; tokenId = downTokenId;
  }

  if (!side) return;

  enteredMarkets.add(market.conditionId);

  const profitPct  = (1 / entryPrice - 1) * 100;
  const potential  = (profitPct / 100 * BET_USDC);
  const timestamp  = new Date().toISOString();

  console.error(
    `[Scalper][${asset}] ENTRADA ${side} @ ${(entryPrice*100).toFixed(1)}¢ | ` +
    `${secsLeft.toFixed(0)}s restantes | Pot: +$${potential.toFixed(2)}`
  );

  // Record trade
  store.scalperTrades.unshift({
    asset: asset.toUpperCase(),
    side,
    entryPrice,
    secsAtEntry: Math.round(secsLeft),
    betUsdc: BET_USDC,
    potentialProfit: parseFloat(potential.toFixed(2)),
    simulate,
    timestamp,
    marketEndTime: market.endDate,
    settled: false,
    won: null,
    pnl: null,
  });
  if (store.scalperTrades.length > 100) store.scalperTrades.pop();

  // Alert
  const simLabel = simulate ? '[SIMULAÇÃO] ' : '';
  await notify(
    `${simLabel}⚡ SCALPER — ${asset.toUpperCase()} ${side} @ ${(entryPrice*100).toFixed(1)}¢ (${Math.round(secsLeft)}s restantes)`,
    [
      `⚡ LAST MINUTE SCALPER — ENTRADA`,
      ``,
      `Ativo: ${asset.toUpperCase()}`,
      `Lado vencedor: ${side}`,
      `Preço de entrada: ${(entryPrice*100).toFixed(1)}¢`,
      `Tempo restante: ${Math.round(secsLeft)}s`,
      ``,
      `💰 Aposta: $${BET_USDC}`,
      `✅ Se ganhar: +$${potential.toFixed(2)} (+${profitPct.toFixed(1)}%)`,
      `❌ Se perder: -$${BET_USDC}`,
      ``,
      `📊 UP: ${(upAsk*100).toFixed(1)}¢  |  DOWN: ${(downAsk*100).toFixed(1)}¢`,
      ``,
      simulate
        ? `⚠️ SIMULAÇÃO — execute manualmente no Polymarket se quiser.`
        : `✅ ORDER ENVIADA — aguardando resultado.`,
    ].join('\n')
  );

  // Schedule settlement check
  const waitMs = Math.max(5000, endMs - Date.now() + 8000);
  setTimeout(() => {
    settleScalperTrade({ tokenId, asset: asset.toUpperCase(), side: side!, entryPrice, simulate, tradeTimestamp: timestamp })
      .catch(err => console.error(`[Scalper] Settle error: ${err.message}`));
  }, waitMs);
}

// ── Entry point ────────────────────────────────────────────────────────────
export async function startLastMinuteScalper(simulate: boolean): Promise<void> {
  const assets = ASSETS.length > 0 ? ASSETS : config.markets;
  console.error(`[Scalper] Iniciando — assets: ${assets.join(',')} | janela: ${WINDOW_SEC}s | entrada: ${ENTRY_MIN*100}-${ENTRY_MAX*100}¢`);

  // Prevent memory leak on long-running sessions
  setInterval(() => {
    if (enteredMarkets.size > 500) enteredMarkets.clear();
  }, 60 * 60 * 1000);

  while (true) {
    for (const asset of assets) {
      try {
        await scanAsset(asset, simulate);
      } catch (err) {
        console.error(`[Scalper][${asset}] Erro: ${(err as Error).message}`);
      }
      await sleep(800);
    }
    await sleep(SCAN_MS);
  }
}
