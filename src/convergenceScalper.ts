/**
 * LAST_MINUTE_5M_CONVERGENCE — implementação completa conforme spec
 */
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { getOrderBookData, nextRoundEndMs, buyShares, sellShares, createClobClient } from './api';
import { updatePrice, store } from './store';
import { notify } from './notifier';
import { config } from './config';

// ── Config ─────────────────────────────────────────────────────────────────
const BET_USDC           = parseFloat(process.env.CONV_BET_USDC        ?? '5');
const ENTRY_MIN          = parseFloat(process.env.CONV_ENTRY_MIN       ?? '0.80');
const ENTRY_MAX          = parseFloat(process.env.CONV_ENTRY_MAX       ?? '0.90');
const MIN_SCORE          = parseFloat(process.env.CONV_MIN_SCORE       ?? '85');
const WINDOW_MIN_SEC     = parseInt  (process.env.CONV_WINDOW_MIN      ?? '15',  10);
const WINDOW_MAX_SEC     = parseInt  (process.env.CONV_WINDOW_MAX      ?? '60',  10);
const DAILY_LOSS_LIMIT   = parseFloat(process.env.CONV_DAILY_LOSS      ?? '30');
const DAILY_PROFIT_TARGET= parseFloat(process.env.CONV_DAILY_TARGET    ?? '200');
const MAX_CONCURRENT     = parseInt  (process.env.CONV_MAX_CONCURRENT  ?? '3',   10);
const MAX_SPREAD         = parseFloat(process.env.CONV_MAX_SPREAD      ?? '0.04');
const MIN_LIQUIDITY_MULT = parseFloat(process.env.CONV_MIN_LIQ_MULT   ?? '1');    // mínimo = X × BET_USDC
const EARLY_EXIT_PRICE   = parseFloat(process.env.CONV_EARLY_EXIT      ?? '0.97');
const DETERIORATION      = parseFloat(process.env.CONV_DETERIORATION   ?? '0.08');
const SCAN_MS            = 5000;
const ASSETS: string[]   = (process.env.CONV_ASSETS ?? 'btc,eth,sol,xrp,doge')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

// ── Data dir & trade log ───────────────────────────────────────────────────
const DATA_DIR   = path.join(process.cwd(), 'data');
const TRADES_LOG = path.join(DATA_DIR, 'trades.jsonl');

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function logTradeToFile(record: object): void {
  try {
    ensureDataDir();
    fs.appendFileSync(TRADES_LOG, JSON.stringify(record) + '\n', 'utf8');
  } catch {}
}

// ── Helpers ────────────────────────────────────────────────────────────────
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function marketLink(market: any): string {
  const slug = market.events?.[0]?.slug ?? market.slug ?? '';
  return `https://polymarket.com/event/${slug}`;
}

// ── Price history (60 × 5s = 5 minutos por asset/side) ────────────────────
const priceHistory = new Map<string, number[]>();

function recordPrice(key: string, price: number): void {
  if (!priceHistory.has(key)) priceHistory.set(key, []);
  const arr = priceHistory.get(key)!;
  arr.push(price);
  if (arr.length > 60) arr.shift();
}

function getHistory(key: string): number[] {
  return priceHistory.get(key) ?? [];
}

// ── Trend analysis ─────────────────────────────────────────────────────────
interface TrendResult {
  stable: boolean;
  reason: string;
  volatility: number;
  trendScore: number;   // 0-20
  avg3m: number;
  avg5m: number;
  consistent: boolean;  // price >= avg3m e avg5m
}

function analyzeTrend(key: string, currentPrice: number): TrendResult {
  const hist = getHistory(key);
  if (hist.length < 12) {
    return { stable: false, reason: 'Dados insuficientes (< 1 min)', volatility: 0, trendScore: 0, avg3m: 0, avg5m: 0, consistent: false };
  }

  const last12  = hist.slice(-12);                          // último 1 min
  const last36  = hist.slice(-36);                          // últimos 3 min
  const lastAll = hist.length >= 60 ? hist.slice(-60) : hist; // últimos 5 min

  const max1m  = Math.max(...last12);
  const min1m  = Math.min(...last12);
  const vol1m  = max1m - min1m;
  const avg3m  = last36.reduce((a, b) => a + b, 0) / last36.length;
  const avg5m  = lastAll.reduce((a, b) => a + b, 0) / lastAll.length;
  const consistent = currentPrice >= avg3m - 0.005 && currentPrice >= avg5m - 0.005;

  // Bloqueios obrigatórios
  if (vol1m > 0.08)
    return { stable: false, reason: `Oscilação alta (${(vol1m*100).toFixed(1)}¢)`, volatility: vol1m, trendScore: 0, avg3m, avg5m, consistent: false };
  if (currentPrice < max1m - 0.05)
    return { stable: false, reason: 'Reversão no último minuto', volatility: vol1m, trendScore: 0, avg3m, avg5m, consistent: false };
  if (currentPrice < avg3m - 0.03)
    return { stable: false, reason: 'Perda de tendência (abaixo avg3m)', volatility: vol1m, trendScore: 0, avg3m, avg5m, consistent: false };

  // Score de tendência (0-20)
  let ts = 20;
  if (vol1m > 0.04)        ts -= 8;
  if (currentPrice < avg5m) ts -= 4;
  if (currentPrice < avg3m) ts -= 8;

  return {
    stable: true,
    reason: `vol ${(vol1m*100).toFixed(1)}¢ | avg3m ${(avg3m*100).toFixed(0)}¢ | avg5m ${(avg5m*100).toFixed(0)}¢`,
    volatility: vol1m,
    trendScore: Math.max(0, ts),
    avg3m, avg5m, consistent,
  };
}

// ── Score (8 fatores, total 100) ───────────────────────────────────────────
interface ScoreBreakdown {
  total: number;
  pricePos: number;    // 25
  trend: number;       // 20
  spreadPts: number;   // 20
  liquidity: number;   // 15
  timeWindow: number;  // 10
  volatility: number;  // 5
  bookDepth: number;   // 3
  consistency: number; // 2
}

function calcScore(
  price: number,
  secsLeft: number,
  trend: TrendResult,
  ob: { spread: number | null; liquidityAtAsk: number; askLevels: number; bidLevels: number }
): ScoreBreakdown {
  // 1. Posição do preço (25 pts) — calibrado para faixa 65-95¢
  let pricePos = 0;
  if      (price >= 0.83 && price <= 0.88)                                          pricePos = 25;
  else if ((price >= 0.79 && price < 0.83) || (price > 0.88 && price <= 0.91))     pricePos = 20;
  else if ((price >= 0.74 && price < 0.79) || (price > 0.91 && price <= 0.94))     pricePos = 14;
  else if ((price >= 0.65 && price < 0.74) || (price > 0.94 && price <= 0.97))     pricePos = 8;
  else                                                                               pricePos = 3;

  // 2. Estabilidade de tendência (20 pts)
  const trendPts = trend.trendScore;

  // 3. Spread (20 pts)
  let spreadPts = 0;
  if (ob.spread !== null) {
    if      (ob.spread <= 0.01) spreadPts = 20;
    else if (ob.spread <= 0.02) spreadPts = 15;
    else if (ob.spread <= 0.03) spreadPts = 10;
    else if (ob.spread <= 0.05) spreadPts = 5;
  }

  // 4. Liquidez (15 pts) — liq disponível vs BET_USDC
  let liqPts = 0;
  if      (ob.liquidityAtAsk >= BET_USDC * 5) liqPts = 15;
  else if (ob.liquidityAtAsk >= BET_USDC * 3) liqPts = 10;
  else if (ob.liquidityAtAsk >= BET_USDC)     liqPts = 5;

  // 5. Janela de tempo (10 pts)
  let timePts = 0;
  if (secsLeft >= 20 && secsLeft <= 45)                                       timePts = 10;
  else if ((secsLeft >= 15 && secsLeft < 20) || (secsLeft > 45 && secsLeft <= 60)) timePts = 6;

  // 6. Volatilidade baixa (5 pts)
  let volPts = 0;
  if      (trend.volatility <= 0.02) volPts = 5;
  else if (trend.volatility <= 0.04) volPts = 3;
  else if (trend.volatility <= 0.06) volPts = 1;

  // 7. Profundidade do livro (3 pts)
  const bookDepth = (ob.askLevels >= 3 && ob.bidLevels >= 3) ? 3 : (ob.askLevels >= 1 ? 1 : 0);

  // 8. Consistência dos últimos minutos (2 pts)
  const consistency = trend.consistent ? 2 : 0;

  const total = Math.min(100, pricePos + trendPts + spreadPts + liqPts + timePts + volPts + bookDepth + consistency);
  return { total, pricePos, trend: trendPts, spreadPts, liquidity: liqPts, timeWindow: timePts, volatility: volPts, bookDepth, consistency };
}

// ── Filtros de qualidade (hard blockers) ───────────────────────────────────
interface QualityCheck { ok: boolean; reason?: string; }

function checkQuality(ob: {
  spread: number | null; liquidityAtAsk: number; totalAskSize: number; askLevels: number;
}): QualityCheck {
  if (ob.spread === null)                              return { ok: false, reason: 'Livro inativo (sem spread)' };
  if (ob.spread > MAX_SPREAD)                         return { ok: false, reason: `Spread alto: ${(ob.spread*100).toFixed(1)}¢` };
  const minLiq = BET_USDC * MIN_LIQUIDITY_MULT;
  if (ob.liquidityAtAsk < minLiq)                     return { ok: false, reason: `Liquidez insuficiente: $${ob.liquidityAtAsk.toFixed(2)} < $${minLiq.toFixed(2)}` };
  if (ob.totalAskSize <= 0)                           return { ok: false, reason: 'Sem vendedores no livro' };
  if (ob.askLevels < 1)                               return { ok: false, reason: 'Livro sem profundidade' };
  return { ok: true };
}

// ── Daily tracking ─────────────────────────────────────────────────────────
let dailyPnl      = 0;
let dailyTrades   = 0;
let dailyWins     = 0;
let dailyDate     = new Date().toDateString();
let activePositions = 0;

function resetDailyIfNeeded(): void {
  const today = new Date().toDateString();
  if (today !== dailyDate) {
    dailyDate = today; dailyPnl = 0; dailyTrades = 0; dailyWins = 0;
    console.error('[Convergence] Novo dia — contadores resetados');
  }
}

function isDailyLimitReached(): boolean {
  if (dailyPnl <= -DAILY_LOSS_LIMIT) {
    console.error(`[Convergence] Limite de perda diária: $${dailyPnl.toFixed(2)}`);
    return true;
  }
  if (dailyPnl >= DAILY_PROFIT_TARGET) {
    console.error(`[Convergence] Meta diária atingida: $${dailyPnl.toFixed(2)}`);
    return true;
  }
  return false;
}

// ── Market finder ──────────────────────────────────────────────────────────
async function findMarket5m(asset: string): Promise<any | null> {
  try {
    const resp = await axios.get(`${config.gammaApiUrl}/markets`, {
      params: { active: true, limit: 200, order: 'createdAt', ascending: false },
      timeout: 8000,
    });
    const now = Date.now();
    const valid = (resp.data ?? []).filter((m: any) =>
      m.slug?.includes(`${asset}-updown-5m`) &&
      m.clobTokenIds && m.endDate &&
      new Date(m.endDate).getTime() > now + 10_000
    );
    if (!valid.length) return null;
    valid.sort((a: any, b: any) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime());
    return valid[0];
  } catch { return null; }
}

// ── Monitoramento da posição (saída antecipada) ────────────────────────────
async function monitorPosition(params: {
  tokenId: string; shares: number; entryPrice: number;
  marketEndMs: number; client: ReturnType<typeof createClobClient>; simulate: boolean;
}): Promise<{ exitPrice: number | null; exitReason: string }> {
  const { tokenId, shares, entryPrice, marketEndMs, client, simulate } = params;

  while (Date.now() < marketEndMs - 5000) {
    await sleep(2000);
    const ob = await getOrderBookData(tokenId);
    if (ob.bestBid === null) continue;
    const bid = ob.bestBid;

    // Saída antecipada: preço convergiu para perto de $1
    if (bid >= EARLY_EXIT_PRICE) {
      const sellAt = parseFloat((bid - 0.005).toFixed(4));
      if (!simulate) await sellShares(client, tokenId, sellAt, shares, false);
      console.error(`[Convergence] Saída antecipada — bid ${(bid*100).toFixed(0)}¢ ≥ ${(EARLY_EXIT_PRICE*100).toFixed(0)}¢ | lucro garantido`);
      return { exitPrice: sellAt, exitReason: 'early_profit' };
    }

    // Stop por deterioração (só se ainda tem tempo útil)
    const secsToEnd = (marketEndMs - Date.now()) / 1000;
    if (bid < entryPrice - DETERIORATION && secsToEnd > 15) {
      const sellAt = parseFloat((bid - 0.01).toFixed(4));
      if (!simulate) await sellShares(client, tokenId, sellAt, shares, false);
      console.error(`[Convergence] Stop por deterioração — bid ${(bid*100).toFixed(0)}¢ | entrada ${(entryPrice*100).toFixed(0)}¢`);
      return { exitPrice: sellAt, exitReason: 'early_stop' };
    }
  }

  return { exitPrice: null, exitReason: 'settlement' };
}

// ── Liquidação / settlement ────────────────────────────────────────────────
async function settle(params: {
  tokenId: string; asset: string; side: 'UP' | 'DOWN';
  entryPrice: number; exitPrice: number | null; exitReason: string;
  shares: number; score: ScoreBreakdown; simulate: boolean; timestamp: string;
  spread: number | null; liquidityAtAsk: number; secsLeft: number;
  marketId: string; volume: number;
}): Promise<void> {
  const { tokenId, asset, side, entryPrice, exitPrice, exitReason, shares, score,
          simulate, timestamp, spread, liquidityAtAsk, secsLeft, marketId, volume } = params;

  let won: boolean;
  let pnl: number;
  let resolvedExitPrice: number;

  if ((exitReason === 'early_profit' || exitReason === 'early_stop') && exitPrice !== null) {
    resolvedExitPrice = exitPrice;
    pnl = shares * (exitPrice - entryPrice);
    won = pnl > 0;
  } else {
    // Aguarda resolução e verifica resultado via Gamma API
    await sleep(25000);
    let wonResult: boolean | null = null;

    // Método 1: Gamma API — campo outcomePrices (["1","0"] ou ["0","1"])
    try {
      const resp = await axios.get(`${config.gammaApiUrl}/markets`, {
        params: { conditionId: marketId, limit: 1 },
        timeout: 8000,
      });
      const markets = Array.isArray(resp.data) ? resp.data : [];
      const m = markets.find((x: any) => x.conditionId === marketId) ?? markets[0];
      if (m?.outcomePrices) {
        const prices = typeof m.outcomePrices === 'string'
          ? JSON.parse(m.outcomePrices) : m.outcomePrices;
        const upP  = parseFloat(prices[0]);
        const dnP  = parseFloat(prices[1]);
        if (!isNaN(upP) && !isNaN(dnP)) {
          wonResult = side === 'UP' ? upP > dnP : dnP > upP;
          console.error(`[Convergence][${asset}] 📡 Gamma: UP=${(upP*100).toFixed(0)}¢ DOWN=${(dnP*100).toFixed(0)}¢ → ${wonResult ? 'WIN' : 'LOSS'}`);
        }
      }
    } catch {}

    // Método 2: CLOB bestBid — vencedor tem bids perto de $1, perdedor perto de $0
    if (wonResult === null) {
      const ob = await getOrderBookData(tokenId);
      const bid = ob.bestBid;
      if (bid !== null) {
        wonResult = bid >= 0.80;
        console.error(`[Convergence][${asset}] 📡 CLOB bid fallback: ${(bid*100).toFixed(0)}¢ → ${wonResult ? 'WIN' : 'LOSS'}`);
      }
    }

    won = wonResult ?? false;
    resolvedExitPrice = won ? 1.0 : 0.0;
    pnl = won ? BET_USDC * (1 / entryPrice - 1) : -BET_USDC;
  }

  dailyPnl += pnl;
  dailyTrades++;
  if (won) dailyWins++;
  activePositions = Math.max(0, activePositions - 1);

  const roi = ((pnl / BET_USDC) * 100).toFixed(1);
  const winRate = dailyTrades > 0 ? (dailyWins / dailyTrades * 100).toFixed(0) : '0';
  const simLabel = simulate ? '[SIM] ' : '';

  // Atualiza store
  const trade = store.scalperTrades.find(t => !t.settled && t.timestamp === timestamp);
  if (trade) {
    trade.settled = true;
    trade.won     = won;
    trade.pnl     = parseFloat(pnl.toFixed(2));
    store.scalperProfit = (store.scalperProfit ?? 0) + pnl;
  }

  // Log completo para arquivo (backtest)
  logTradeToFile({
    timestamp, asset, marketId, side,
    entryPrice : parseFloat(entryPrice.toFixed(4)),
    exitPrice  : parseFloat(resolvedExitPrice.toFixed(4)),
    exitReason, secsLeft, shares,
    volume     : parseFloat(volume.toFixed(2)),
    liquidity  : parseFloat(liquidityAtAsk.toFixed(2)),
    spread     : spread !== null ? parseFloat(spread.toFixed(4)) : null,
    score      : score.total,
    scoreBreakdown: {
      pricePos   : score.pricePos,
      trend      : score.trend,
      spread     : score.spreadPts,
      liquidity  : score.liquidity,
      timeWindow : score.timeWindow,
      volatility : score.volatility,
      bookDepth  : score.bookDepth,
      consistency: score.consistency,
    },
    won, pnl: parseFloat(pnl.toFixed(4)),
    roi: parseFloat(roi),
    simulate,
  });

  console.error(
    `[Convergence][${asset}] ${won ? '✅ WIN' : '❌ LOSS'} (${exitReason}) | ` +
    `PnL: ${pnl > 0 ? '+' : ''}$${pnl.toFixed(2)} | ROI: ${pnl > 0 ? '+' : ''}${roi}% | ` +
    `Dia: ${dailyPnl >= 0 ? '+' : ''}$${dailyPnl.toFixed(2)} | ${winRate}% (${dailyWins}/${dailyTrades})`
  );

  await notify(
    `${simLabel}${won ? '✅ WIN' : '❌ LOSS'} ${asset} ${side} | ${pnl > 0 ? '+' : ''}$${pnl.toFixed(2)} | Dia: ${dailyPnl >= 0 ? '+' : ''}$${dailyPnl.toFixed(2)}`,
    [
      won ? `✅ GANHOU! ${pnl > 0 ? '+' : ''}$${pnl.toFixed(2)}` : `❌ PERDEU $${Math.abs(pnl).toFixed(2)}`,
      ``,
      `Ativo: ${asset} ${side} @ ${(entryPrice*100).toFixed(0)}¢`,
      `Saída: ${(resolvedExitPrice*100).toFixed(0)}¢ (${exitReason}) | ROI: ${pnl > 0 ? '+' : ''}${roi}%`,
      `Score: ${score.total}/100`,
      ``,
      `📊 Hoje: ${dailyPnl >= 0 ? '+' : ''}$${dailyPnl.toFixed(2)} | ${dailyWins}/${dailyTrades} (${winRate}%)`,
      `🎯 Meta: $${DAILY_PROFIT_TARGET} | Limite: -$${DAILY_LOSS_LIMIT}`,
    ].join('\n')
  );
}

// ── Per-asset state ────────────────────────────────────────────────────────
const enteredRounds  = new Set<string>();
const scanCounters   = new Map<string, number>(); // heartbeat por asset

// ── Main scan ──────────────────────────────────────────────────────────────
async function scanAsset(
  asset: string,
  simulate: boolean,
  client: ReturnType<typeof createClobClient>
): Promise<void> {
  const market = await findMarket5m(asset);
  if (!market) {
    // Log a cada 12 ciclos (~1 min) para não spammar
    const k = `${asset}-nf`;
    const c = (scanCounters.get(k) ?? 0) + 1;
    scanCounters.set(k, c);
    if (c % 12 === 0) console.error(`[Convergence][${asset}] ⚠️  Mercado 5m não encontrado na API`);
    return;
  }

  const endMs    = nextRoundEndMs(5);
  const secsLeft = (endMs - Date.now()) / 1000;

  let tokenIds: string[];
  try {
    tokenIds = typeof market.clobTokenIds === 'string'
      ? JSON.parse(market.clobTokenIds) : market.clobTokenIds;
  } catch { return; }
  const [upTokenId, downTokenId] = tokenIds;

  // Busca order book completo para ambos os lados
  const [upOb, downOb] = await Promise.all([
    getOrderBookData(upTokenId),
    getOrderBookData(downTokenId),
  ]);

  const upAsk   = upOb.bestAsk;
  const downAsk = downOb.bestAsk;
  if (upAsk === null || downAsk === null) return;

  // Atualiza dashboard e histórico de preços
  updatePrice(asset, 'up', upAsk);
  updatePrice(asset, 'down', downAsk);
  recordPrice(`${asset}-up`,   upAsk);
  recordPrice(`${asset}-down`, downAsk);

  // Heartbeat a cada ~1 minuto: mostra o que o bot está vendo
  const hk = `${asset}-hb`;
  const hc = (scanCounters.get(hk) ?? 0) + 1;
  scanCounters.set(hk, hc);
  if (hc % 12 === 0) {
    const dom  = upAsk >= downAsk ? 'UP' : 'DOWN';
    const dom$ = (Math.max(upAsk, downAsk) * 100).toFixed(0);
    const inWin = secsLeft >= WINDOW_MIN_SEC && secsLeft <= WINDOW_MAX_SEC;
    console.error(
      `[Convergence][${asset}] 👁  UP:${(upAsk*100).toFixed(0)}¢ DOWN:${(downAsk*100).toFixed(0)}¢ | ` +
      `dom: ${dom}@${dom$}¢ | ${secsLeft.toFixed(0)}s p/ fim | janela: ${inWin ? '✅' : '❌'} | ` +
      `trades hoje: ${dailyTrades}`
    );
  }

  // Janela de tempo
  if (secsLeft < WINDOW_MIN_SEC || secsLeft > WINDOW_MAX_SEC) return;

  // Já entrou nesse round?
  const roundKey = `${market.conditionId}-conv`;
  if (enteredRounds.has(roundKey)) return;

  // Limite de posições simultâneas
  if (activePositions >= MAX_CONCURRENT) {
    console.error(`[Convergence][${asset}] Limite de posições: ${activePositions}/${MAX_CONCURRENT}`);
    return;
  }

  // Lado dominante
  const dominantSide  = upAsk >= downAsk ? 'UP' : 'DOWN';
  const dominantPrice = dominantSide === 'UP' ? upAsk : downAsk;
  const dominantToken = dominantSide === 'UP' ? upTokenId : downTokenId;
  const dominantOb    = dominantSide === 'UP' ? upOb : downOb;
  const trendKey      = `${asset}-${dominantSide.toLowerCase()}`;

  // Log sempre que estiver na janela (para diagnóstico)
  console.error(
    `[Convergence][${asset}] 🔍 ${dominantSide}@${(dominantPrice*100).toFixed(0)}¢ | ${secsLeft.toFixed(0)}s | ` +
    `spread:${dominantOb.spread !== null ? (dominantOb.spread*100).toFixed(1) : '?'}¢ | liq:$${dominantOb.liquidityAtAsk.toFixed(1)}`
  );

  // Faixa de preço
  if (dominantPrice < ENTRY_MIN || dominantPrice > ENTRY_MAX) {
    console.error(`[Convergence][${asset}] ❌ Preço fora da faixa (${(dominantPrice*100).toFixed(0)}¢ | faixa: ${(ENTRY_MIN*100).toFixed(0)}-${(ENTRY_MAX*100).toFixed(0)}¢)`);
    return;
  }

  // Filtros de qualidade (liquidez, spread, profundidade)
  const quality = checkQuality({
    spread        : dominantOb.spread,
    liquidityAtAsk: dominantOb.liquidityAtAsk,
    totalAskSize  : dominantOb.totalAskSize,
    askLevels     : dominantOb.askLevels,
  });
  if (!quality.ok) {
    console.error(`[Convergence][${asset}] ❌ Qualidade: ${quality.reason}`);
    return;
  }

  // Confirmação de tendência
  const trend = analyzeTrend(trendKey, dominantPrice);
  if (!trend.stable) {
    console.error(`[Convergence][${asset}] ❌ Tendência: ${trend.reason}`);
    return;
  }

  // Score de qualidade (8 fatores)
  const scoreResult = calcScore(dominantPrice, secsLeft, trend, dominantOb);
  console.error(
    `[Convergence][${asset}] 📊 Score: ${scoreResult.total}/100 | ` +
    `preço:${scoreResult.pricePos} tend:${scoreResult.trend} spread:${scoreResult.spreadPts} ` +
    `liq:${scoreResult.liquidity} tempo:${scoreResult.timeWindow} vol:${scoreResult.volatility}`
  );

  if (scoreResult.total < MIN_SCORE) {
    console.error(`[Convergence][${asset}] ❌ Score insuficiente (${scoreResult.total} < ${MIN_SCORE})`);
    return;
  }

  if (isDailyLimitReached()) return;

  // ── ENTRADA ──
  enteredRounds.add(roundKey);
  activePositions++;
  const shares    = parseFloat((BET_USDC / dominantPrice).toFixed(2));
  const potential = (BET_USDC * (1 / dominantPrice - 1)).toFixed(2);
  const timestamp = new Date().toISOString();
  const simLabel  = simulate ? '🔔 [SINAL]' : '⚡ [EXECUTADO]';

  console.error(
    `[Convergence][${asset}] ✅ ENTRADA ${dominantSide} @ ${(dominantPrice*100).toFixed(0)}¢ | ` +
    `Score: ${scoreResult.total} | ${secsLeft.toFixed(0)}s | $${BET_USDC} → ${shares} shares | pot: +$${potential}`
  );

  if (!simulate) {
    const orderId = await buyShares(client, dominantToken, dominantPrice, shares, false);
    if (!orderId) {
      console.error(`[Convergence][${asset}] ⚠️  FOK cancelado (sem contraparte) — aguarda próximo round`);
      enteredRounds.delete(roundKey);
      activePositions--;
      return;
    }
    console.error(`[Convergence][${asset}] 📝 Ordem aceita: ${orderId}`);
  }

  store.scalperTrades.unshift({
    asset: asset.toUpperCase(), side: dominantSide, entryPrice: dominantPrice,
    secsAtEntry: Math.round(secsLeft), betUsdc: BET_USDC,
    potentialProfit: parseFloat(potential),
    simulate, timestamp, marketEndTime: market.endDate,
    settled: false, won: null, pnl: null,
  });
  if (store.scalperTrades.length > 200) store.scalperTrades.pop();

  await notify(
    `${simLabel} ${asset.toUpperCase()} ${dominantSide} @ ${(dominantPrice*100).toFixed(0)}¢ | Score ${scoreResult.total} | ${Math.round(secsLeft)}s`,
    [
      `⚡ CONVERGENCE — ${asset.toUpperCase()} ${dominantSide}`,
      ``,
      `📌 Lado dominante: ${dominantSide} @ ${(dominantPrice*100).toFixed(0)}¢`,
      `⏱ Tempo restante: ${Math.round(secsLeft)}s`,
      `🎯 Score: ${scoreResult.total}/100`,
      `   Preço:${scoreResult.pricePos} | Tendência:${scoreResult.trend} | Spread:${scoreResult.spreadPts}`,
      `   Liquidez:${scoreResult.liquidity} | Tempo:${scoreResult.timeWindow} | Vol:${scoreResult.volatility} | Livro:${scoreResult.bookDepth}`,
      ``,
      `📊 Spread: ${dominantOb.spread !== null ? (dominantOb.spread*100).toFixed(1) : '?'}¢ | Liq: $${dominantOb.liquidityAtAsk.toFixed(1)} | Níveis: ${dominantOb.askLevels}`,
      `✅ Tendência: ${trend.reason}`,
      ``,
      `💰 $${BET_USDC} → ${shares} shares | pot: +$${potential}`,
      `📈 Saída antecipada se ≥ ${(EARLY_EXIT_PRICE*100).toFixed(0)}¢`,
      `📊 Dia: ${dailyPnl >= 0 ? '+' : ''}$${dailyPnl.toFixed(2)} | Meta: $${DAILY_PROFIT_TARGET}`,
      simulate ? `\n🔗 ${marketLink(market)}` : '',
    ].join('\n')
  );

  // Monitora posição + liquida em background
  setTimeout(async () => {
    try {
      const { exitPrice, exitReason } = await monitorPosition({
        tokenId: dominantToken, shares, entryPrice: dominantPrice,
        marketEndMs: endMs, client, simulate,
      });
      await settle({
        tokenId: dominantToken, asset: asset.toUpperCase(), side: dominantSide,
        entryPrice: dominantPrice, exitPrice, exitReason, shares,
        score: scoreResult, simulate, timestamp,
        spread: dominantOb.spread, liquidityAtAsk: dominantOb.liquidityAtAsk,
        secsLeft: Math.round(secsLeft), marketId: market.conditionId,
        volume: dominantOb.totalAskSize,
      });
    } catch (err) {
      console.error(`[Convergence] Settle error: ${(err as Error).message}`);
      activePositions = Math.max(0, activePositions - 1);
    }
  }, 1000);
}

// ── Entry point ────────────────────────────────────────────────────────────
export async function startConvergenceScalper(simulate: boolean): Promise<void> {
  const client = createClobClient();
  ensureDataDir();
  console.error(
    `[Convergence] Iniciando — assets: ${ASSETS.join(',')} | faixa: ${ENTRY_MIN*100}-${ENTRY_MAX*100}¢ | ` +
    `janela: ${WINDOW_MIN_SEC}-${WINDOW_MAX_SEC}s | score mín: ${MIN_SCORE} | aposta: $${BET_USDC} | ` +
    `max simultâneas: ${MAX_CONCURRENT} | meta: $${DAILY_PROFIT_TARGET}/dia`
  );

  setInterval(() => {
    if (enteredRounds.size > 2000) enteredRounds.clear();
    if (priceHistory.size > 100)  priceHistory.clear();
    resetDailyIfNeeded();
  }, 5 * 60 * 1000);

  while (true) {
    resetDailyIfNeeded();
    if (!isDailyLimitReached()) {
      for (const asset of ASSETS) {
        try { await scanAsset(asset, simulate, client); }
        catch (err) { console.error(`[Convergence][${asset}] Erro: ${(err as Error).message}`); }
        await sleep(300);
      }
    }
    await sleep(SCAN_MS);
  }
}
