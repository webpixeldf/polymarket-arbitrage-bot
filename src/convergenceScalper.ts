/**
 * LAST_MINUTE_5M_CONVERGENCE
 * Compra o lado dominante (80-90¢) nos últimos 20-45s do round de 5 minutos.
 * Confirma tendência estável antes de entrar. Score >= 85 obrigatório.
 */
import axios from 'axios';
import { getBestAsk, nextRoundEndMs, buyShares, createClobClient } from './api';
import { updatePrice, store } from './store';
import { notify } from './notifier';
import { config } from './config';

// ── Config ─────────────────────────────────────────────────────────────────
const BET_USDC        = parseFloat(process.env.CONV_BET_USDC      ?? '5');
const ENTRY_MIN       = parseFloat(process.env.CONV_ENTRY_MIN     ?? '0.80');
const ENTRY_MAX       = parseFloat(process.env.CONV_ENTRY_MAX     ?? '0.90');
const MIN_SCORE       = parseFloat(process.env.CONV_MIN_SCORE     ?? '85');
const WINDOW_MIN_SEC  = parseInt  (process.env.CONV_WINDOW_MIN    ?? '15',  10);
const WINDOW_MAX_SEC  = parseInt  (process.env.CONV_WINDOW_MAX    ?? '60',  10);
const DAILY_LOSS_LIMIT = parseFloat(process.env.CONV_DAILY_LOSS   ?? '30');
const DAILY_PROFIT_TARGET = parseFloat(process.env.CONV_DAILY_TARGET ?? '200');
const SCAN_MS         = 5000; // poll a cada 5s para precisão
const ASSETS: string[] = (process.env.CONV_ASSETS ?? 'btc,eth,sol,xrp,doge')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function marketLink(market: any): string {
  const slug = market.events?.[0]?.slug ?? market.slug ?? '';
  return `https://polymarket.com/event/${slug}`;
}

// ── Price history ──────────────────────────────────────────────────────────
// Mantém últimos 60 preços por chave (asset-side) = 5 minutos a cada 5s
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
  trendScore: number; // 0-30
}

function analyzeTrend(key: string, currentPrice: number): TrendResult {
  const hist = getHistory(key);
  if (hist.length < 12) {
    return { stable: false, reason: 'Dados insuficientes (< 1 min)', volatility: 0, trendScore: 0 };
  }

  const last12 = hist.slice(-12);  // último 1 minuto
  const last36 = hist.slice(-36);  // últimos 3 minutos
  const lastAll = hist.length >= 60 ? hist.slice(-60) : hist; // últimos 5 min

  const max1m = Math.max(...last12);
  const min1m = Math.min(...last12);
  const volatility1m = max1m - min1m;

  const avg3m = last36.reduce((a, b) => a + b, 0) / last36.length;
  const avg5m = lastAll.reduce((a, b) => a + b, 0) / lastAll.length;

  // Bloqueios
  if (volatility1m > 0.08) {
    return { stable: false, reason: `Oscilação alta no último minuto (${(volatility1m*100).toFixed(1)}¢)`, volatility: volatility1m, trendScore: 0 };
  }

  // Reversão: preço caiu mais de 5% em relação ao máximo recente
  if (currentPrice < max1m - 0.05) {
    return { stable: false, reason: 'Reversão detectada no último minuto', volatility: volatility1m, trendScore: 0 };
  }

  // Tendência deve estar mantendo ou subindo
  if (currentPrice < avg3m - 0.03) {
    return { stable: false, reason: 'Perda de tendência (abaixo da média de 3 min)', volatility: volatility1m, trendScore: 0 };
  }

  // Score de tendência
  let trendScore = 30;
  if (volatility1m > 0.04) trendScore -= 10;
  if (currentPrice < avg5m) trendScore -= 5;
  if (currentPrice < avg3m) trendScore -= 10;

  return {
    stable: true,
    reason: `Estável — vol ${(volatility1m*100).toFixed(1)}¢ | média 3m: ${(avg3m*100).toFixed(0)}¢`,
    volatility: volatility1m,
    trendScore: Math.max(0, trendScore),
  };
}

// ── Score calculation ──────────────────────────────────────────────────────
function calcScore(price: number, secsLeft: number, trend: TrendResult): number {
  let score = 0;

  // 1. Price position (30 pts) — ideal: 0.83-0.88
  if (price >= 0.83 && price <= 0.88) score += 30;
  else if (price >= 0.81 && price < 0.83) score += 20;
  else if (price > 0.88 && price <= 0.90) score += 20;
  else score += 10;

  // 2. Trend stability (30 pts)
  score += trend.trendScore;

  // 3. Time window (20 pts) — ideal: 20-45s
  if (secsLeft >= 20 && secsLeft <= 45) score += 20;
  else if (secsLeft >= 15 && secsLeft < 20) score += 12;
  else if (secsLeft > 45 && secsLeft <= 60) score += 12;
  else score += 0;

  // 4. Volatility bonus (20 pts)
  if (trend.volatility <= 0.02) score += 20;
  else if (trend.volatility <= 0.04) score += 15;
  else if (trend.volatility <= 0.06) score += 8;
  else score += 0;

  return Math.min(100, score);
}

// ── Daily tracking ─────────────────────────────────────────────────────────
let dailyPnl   = 0;
let dailyTrades = 0;
let dailyWins  = 0;
let dailyDate  = new Date().toDateString();

function resetDailyIfNeeded(): void {
  const today = new Date().toDateString();
  if (today !== dailyDate) {
    dailyDate = today;
    dailyPnl = 0; dailyTrades = 0; dailyWins = 0;
    console.error('[Convergence] Novo dia — contadores resetados');
  }
}

function isDailyLimitReached(): boolean {
  if (dailyPnl <= -DAILY_LOSS_LIMIT) {
    console.error(`[Convergence] Limite de perda diária atingido: $${dailyPnl.toFixed(2)}`);
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

// ── Settlement ─────────────────────────────────────────────────────────────
async function settle(params: {
  tokenId: string; asset: string; side: 'UP' | 'DOWN';
  entryPrice: number; score: number; simulate: boolean; timestamp: string;
}): Promise<void> {
  const { tokenId, asset, side, entryPrice, score, simulate, timestamp } = params;
  await sleep(10_000);
  const finalPrice = await getBestAsk(tokenId);
  const won = finalPrice !== null && finalPrice >= 0.95;
  const profit = won ? BET_USDC * (1 / entryPrice - 1) : -BET_USDC;

  dailyPnl += profit;
  dailyTrades++;
  if (won) dailyWins++;

  const winRate = dailyTrades > 0 ? (dailyWins / dailyTrades * 100).toFixed(0) : '0';
  const simLabel = simulate ? '[SIM] ' : '';

  const trade = store.scalperTrades.find(t => !t.settled && t.timestamp === timestamp);
  if (trade) {
    trade.settled = true; trade.won = won; trade.pnl = parseFloat(profit.toFixed(2));
    if (won) store.scalperProfit += profit; else store.scalperProfit += profit;
  }

  console.error(
    `[Convergence][${asset}] ${won ? '✅ WIN' : '❌ LOSS'} | PnL: ${profit > 0 ? '+' : ''}$${profit.toFixed(2)} | ` +
    `Dia: ${dailyPnl >= 0 ? '+' : ''}$${dailyPnl.toFixed(2)} | Acerto: ${winRate}% (${dailyWins}/${dailyTrades})`
  );

  await notify(
    `${simLabel}${won ? '✅ WIN' : '❌ LOSS'} ${asset.toUpperCase()} ${side} | Dia: ${dailyPnl >= 0 ? '+' : ''}$${dailyPnl.toFixed(2)}`,
    [
      won
        ? `✅ GANHOU! +$${profit.toFixed(2)}`
        : `❌ PERDEU -$${BET_USDC.toFixed(2)}`,
      ``,
      `Ativo: ${asset.toUpperCase()} ${side} @ ${(entryPrice*100).toFixed(0)}¢`,
      `Score: ${score}/100`,
      ``,
      `📊 Hoje: ${dailyPnl >= 0 ? '+' : ''}$${dailyPnl.toFixed(2)} | ${dailyWins}/${dailyTrades} (${winRate}%)`,
      `🎯 Meta: $${DAILY_PROFIT_TARGET} | Limite perda: -$${DAILY_LOSS_LIMIT}`,
    ].join('\n')
  );
}

// ── Per-asset state ────────────────────────────────────────────────────────
const enteredRounds = new Set<string>();

// ── Main scan ──────────────────────────────────────────────────────────────
async function scanAsset(
  asset: string,
  simulate: boolean,
  client: ReturnType<typeof createClobClient>
): Promise<void> {
  const market = await findMarket5m(asset);
  if (!market) return;

  const endMs    = nextRoundEndMs(5);
  const secsLeft = (endMs - Date.now()) / 1000;

  let tokenIds: string[];
  try {
    tokenIds = typeof market.clobTokenIds === 'string'
      ? JSON.parse(market.clobTokenIds) : market.clobTokenIds;
  } catch { return; }
  const [upTokenId, downTokenId] = tokenIds;

  const [upAsk, downAsk] = await Promise.all([getBestAsk(upTokenId), getBestAsk(downTokenId)]);
  if (upAsk === null || downAsk === null) return;

  // Atualiza dashboard e histórico
  updatePrice(asset, 'up', upAsk);
  updatePrice(asset, 'down', downAsk);
  recordPrice(`${asset}-up`,   upAsk);
  recordPrice(`${asset}-down`, downAsk);

  // Só considera entrada na janela de tempo
  if (secsLeft < WINDOW_MIN_SEC || secsLeft > WINDOW_MAX_SEC) return;

  // Já entrou nesse round?
  const roundKey = `${market.conditionId}-conv`;
  if (enteredRounds.has(roundKey)) return;

  // Identifica o lado dominante (maior probabilidade)
  const dominantSide  = upAsk >= downAsk ? 'UP' : 'DOWN';
  const dominantPrice = dominantSide === 'UP' ? upAsk : downAsk;
  const dominantToken = dominantSide === 'UP' ? upTokenId : downTokenId;
  const trendKey      = `${asset}-${dominantSide.toLowerCase()}`;

  // Faixa de preço obrigatória
  if (dominantPrice < ENTRY_MIN || dominantPrice > ENTRY_MAX) return;

  // Análise de tendência
  const trend = analyzeTrend(trendKey, dominantPrice);
  if (!trend.stable) {
    console.error(`[Convergence][${asset}] Bloqueado — ${trend.reason}`);
    return;
  }

  // Score
  const score = calcScore(dominantPrice, secsLeft, trend);
  console.error(
    `[Convergence][${asset}] ${dominantSide} @ ${(dominantPrice*100).toFixed(0)}¢ | ` +
    `${secsLeft.toFixed(0)}s | Score: ${score}/100 | ${trend.reason}`
  );

  if (score < MIN_SCORE) {
    console.error(`[Convergence][${asset}] Score insuficiente (${score} < ${MIN_SCORE}) — ignorando`);
    return;
  }

  // Limite diário
  if (isDailyLimitReached()) return;

  // ENTRAR
  enteredRounds.add(roundKey);
  const shares    = Math.floor((BET_USDC / dominantPrice) * 10) / 10;
  const potential = (BET_USDC * (1 / dominantPrice - 1)).toFixed(2);
  const timestamp = new Date().toISOString();
  const simLabel  = simulate ? '🔔 [SINAL]' : '⚡ [EXECUTADO]';

  console.error(
    `[Convergence][${asset}] ✅ ENTRADA ${dominantSide} @ ${(dominantPrice*100).toFixed(0)}¢ | ` +
    `Score: ${score} | ${secsLeft.toFixed(0)}s | $${BET_USDC} → ${shares} shares | pot: +$${potential}`
  );

  if (!simulate) {
    await buyShares(client, dominantToken, dominantPrice, shares, false);
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
    `${simLabel} ${asset.toUpperCase()} ${dominantSide} @ ${(dominantPrice*100).toFixed(0)}¢ | Score ${score} | ${Math.round(secsLeft)}s`,
    [
      `⚡ CONVERGENCE — ${asset.toUpperCase()} ${dominantSide}`,
      ``,
      `📌 Lado dominante: ${dominantSide} @ ${(dominantPrice*100).toFixed(0)}¢`,
      `⏱ Tempo restante: ${Math.round(secsLeft)}s`,
      `🎯 Score de qualidade: ${score}/100`,
      ``,
      `✅ Tendência: ${trend.reason}`,
      ``,
      `💰 Aposta: $${BET_USDC} → ${shares} shares`,
      `   Se ganhar: +$${potential}`,
      `   Se perder: -$${BET_USDC}`,
      ``,
      `📊 Dia: ${dailyPnl >= 0 ? '+' : ''}$${dailyPnl.toFixed(2)} | Meta: $${DAILY_PROFIT_TARGET}`,
      simulate ? `\n🔗 ${marketLink(market)}` : '',
    ].join('\n')
  );

  const waitMs = Math.max(5000, endMs - Date.now() + 10_000);
  setTimeout(() => {
    settle({ tokenId: dominantToken, asset: asset.toUpperCase(), side: dominantSide, entryPrice: dominantPrice, score, simulate, timestamp })
      .catch(err => console.error(`[Convergence] Settle error: ${err.message}`));
  }, waitMs);
}

// ── Entry point ────────────────────────────────────────────────────────────
export async function startConvergenceScalper(simulate: boolean): Promise<void> {
  const client = createClobClient();
  console.error(
    `[Convergence] Iniciando — assets: ${ASSETS.join(',')} | faixa: ${ENTRY_MIN*100}-${ENTRY_MAX*100}¢ | ` +
    `janela: ${WINDOW_MIN_SEC}-${WINDOW_MAX_SEC}s | score mín: ${MIN_SCORE} | aposta: $${BET_USDC} | meta: $${DAILY_PROFIT_TARGET}/dia`
  );

  setInterval(() => {
    if (enteredRounds.size > 2000) enteredRounds.clear();
    if (priceHistory.size > 100) priceHistory.clear();
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
