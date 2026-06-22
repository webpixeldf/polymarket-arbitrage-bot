/**
 * Finance Scanner — S&P 500, Nasdaq, Gold
 * Opera mercados diários no Polymarket usando preço real das bolsas via Yahoo Finance
 * Janela de entrada: 20-90 minutos antes do fechamento NYSE (16h ET)
 */
import axios from 'axios';
import { config } from './config';
import { buyShares, createClobClient, getOrderBookData } from './api';
import { notify } from './notifier';

// ── Config (via .env) ──────────────────────────────────────────────────────
const BET_USDC       = parseFloat(process.env.FIN_BET_USDC      ?? '1');
const MIN_DEVIATION  = parseFloat(process.env.FIN_MIN_DEVIATION  ?? '2.0');  // % acima/abaixo do threshold
const WINDOW_MIN_MIN = parseInt  (process.env.FIN_WINDOW_MIN_MIN ?? '20',  10);
const WINDOW_MAX_MIN = parseInt  (process.env.FIN_WINDOW_MAX_MIN ?? '90',  10);
const SCAN_MS        = 60_000;

// ── Assets ─────────────────────────────────────────────────────────────────
const ASSETS = [
  { name: 'SP500',  symbol: '^GSPC', keywords: ["s&p", "sp500", "spx", "spy"],  minP: 3000, maxP: 8000  },
  { name: 'NASDAQ', symbol: '^IXIC', keywords: ["nasdaq", "qqq", "ndx"],         minP: 8000, maxP: 25000 },
  { name: 'GOLD',   symbol: 'GC=F',  keywords: ["gold", "xau"],                  minP: 1000, maxP: 4000  },
];

// ── NYSE helpers ────────────────────────────────────────────────────────────
function etOffsetHours(): number {
  // DST: segunda dom de março até primeira dom de novembro (aproximação mensal)
  const m = new Date().getUTCMonth() + 1; // 1-12
  return (m >= 4 && m <= 10) ? 4 : 5; // UTC-4 verão, UTC-5 inverno
}

function isNYSEOpen(): boolean {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Dom, 6=Sab
  if (day === 0 || day === 6) return false;
  const etMins = (now.getUTCHours() - etOffsetHours()) * 60 + now.getUTCMinutes();
  return etMins >= 9 * 60 + 30 && etMins < 16 * 60;
}

function getNYSECloseMs(): number {
  const d = new Date();
  d.setUTCHours(16 + etOffsetHours(), 0, 0, 0);
  if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
  return d.getTime();
}

function minsToClose(): number {
  return (getNYSECloseMs() - Date.now()) / 60_000;
}

// ── Yahoo Finance ───────────────────────────────────────────────────────────
async function getYahooPrice(symbol: string): Promise<number | null> {
  try {
    const resp = await axios.get(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`,
      { params: { interval: '1m', range: '1d' }, timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    const meta = resp.data?.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice ?? meta?.previousClose;
    return typeof price === 'number' ? price : null;
  } catch {
    return null;
  }
}

// ── Gamma API: mercados de finance ativos hoje ─────────────────────────────
async function findTodayMarkets(keywords: string[]): Promise<any[]> {
  try {
    const resp = await axios.get(`${config.gammaApiUrl}/markets`, {
      params: { active: true, limit: 500, order: 'createdAt', ascending: false },
      timeout: 10000,
    });
    const now = Date.now();
    return ((resp.data ?? []) as any[]).filter(m => {
      if (!m.question || !m.endDate || !m.clobTokenIds) return false;
      const endMs = new Date(m.endDate).getTime();
      if (endMs < now || endMs > now + 14 * 60 * 60 * 1000) return false; // resolve em até 14h
      const q = (m.question ?? '').toLowerCase();
      return keywords.some(k => q.includes(k));
    });
  } catch {
    return [];
  }
}

// ── Parse: extrai threshold e direção da pergunta ──────────────────────────
interface ThresholdResult { threshold: number; direction: 'above' | 'below'; }

function parseThreshold(question: string, minP: number, maxP: number): ThresholdResult | null {
  const q = question.toLowerCase();
  const isAbove = /\b(above|higher|over|exceed|greater|surpass)\b/.test(q);
  const isBelow = /\b(below|lower|under|less than|drop)\b/.test(q);
  if (!isAbove && !isBelow) return null;

  const nums = (question.match(/[\d,]+(?:\.\d+)?/g) ?? [])
    .map(n => parseFloat(n.replace(/,/g, '')))
    .filter(n => n >= minP && n <= maxP);
  if (nums.length === 0) return null;

  return { threshold: nums[0], direction: isAbove ? 'above' : 'below' };
}

// ── Estado ─────────────────────────────────────────────────────────────────
const entered = new Set<string>();
let dailyPnl = 0; let dailyTrades = 0; let dailyWins = 0;
let dailyDate = new Date().toDateString();

function resetIfNewDay(): void {
  const today = new Date().toDateString();
  if (today !== dailyDate) {
    dailyDate = today; dailyPnl = 0; dailyTrades = 0; dailyWins = 0;
    entered.clear();
    console.error('[Finance] Novo dia — contadores resetados');
  }
}

function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

// ── Settle ─────────────────────────────────────────────────────────────────
async function settleFinance(params: {
  assetName: string; betSide: 'YES' | 'NO';
  entryPrice: number; shares: number;
  simulate: boolean; marketId: string;
}): Promise<void> {
  const { assetName, betSide, entryPrice, shares, simulate, marketId } = params;

  await sleep(30_000); // aguarda Gamma atualizar

  let won: boolean | null = null;
  try {
    const resp = await axios.get(`${config.gammaApiUrl}/markets`, {
      params: { conditionId: marketId, limit: 1 },
      timeout: 8000,
    });
    const markets = Array.isArray(resp.data) ? resp.data : [];
    const m = markets.find((x: any) => x.conditionId === marketId) ?? markets[0];
    if (m?.outcomePrices) {
      const prices = typeof m.outcomePrices === 'string' ? JSON.parse(m.outcomePrices) : m.outcomePrices;
      const yesP = parseFloat(prices[0]);
      const noP  = parseFloat(prices[1]);
      if (!isNaN(yesP)) {
        won = betSide === 'YES' ? yesP > noP : noP > yesP;
        console.error(`[Finance][${assetName}] 📡 Gamma: YES=${(yesP*100).toFixed(0)}¢ NO=${(noP*100).toFixed(0)}¢ → ${won ? 'WIN' : 'LOSS'}`);
      }
    }
  } catch {}

  if (won === null) won = false;

  const pnl = won ? BET_USDC * (1 / entryPrice - 1) : -BET_USDC;
  dailyPnl += pnl; dailyTrades++;
  if (won) dailyWins++;

  const winRate = (dailyWins / dailyTrades * 100).toFixed(0);
  console.error(
    `[Finance][${assetName}] ${won ? '✅ WIN' : '❌ LOSS'} | ` +
    `PnL: ${pnl > 0 ? '+' : ''}$${pnl.toFixed(2)} | Dia: ${dailyPnl >= 0 ? '+' : ''}$${dailyPnl.toFixed(2)} | ${winRate}% (${dailyWins}/${dailyTrades})`
  );

  const simLabel = simulate ? '[SIM] ' : '';
  await notify(
    `${simLabel}${won ? '✅ WIN' : '❌ LOSS'} FINANCE ${assetName} ${betSide} | ${pnl > 0 ? '+' : ''}$${pnl.toFixed(2)} | Dia: ${dailyPnl >= 0 ? '+' : ''}$${dailyPnl.toFixed(2)}`,
    [
      won ? `✅ GANHOU! +$${pnl.toFixed(2)}` : `❌ PERDEU $${Math.abs(pnl).toFixed(2)}`,
      `Ativo: ${assetName} ${betSide} @ ${(entryPrice*100).toFixed(0)}¢`,
      `📊 Hoje (Finance): ${dailyPnl >= 0 ? '+' : ''}$${dailyPnl.toFixed(2)} | ${dailyWins}/${dailyTrades} (${winRate}%)`,
    ].join('\n')
  );
}

// ── Scan de um asset ───────────────────────────────────────────────────────
async function scanAsset(
  asset: typeof ASSETS[0],
  simulate: boolean,
  client: ReturnType<typeof createClobClient>
): Promise<void> {
  const mins = minsToClose();
  if (mins < WINDOW_MIN_MIN || mins > WINDOW_MAX_MIN) return;

  const currentPrice = await getYahooPrice(asset.symbol);
  if (currentPrice === null) {
    console.error(`[Finance][${asset.name}] ⚠️  Yahoo Finance sem resposta`);
    return;
  }

  const markets = await findTodayMarkets(asset.keywords);
  if (markets.length === 0) return;

  for (const market of markets) {
    const key = `fin-${market.conditionId}`;
    if (entered.has(key)) continue;

    const parsed = parseThreshold(market.question, asset.minP, asset.maxP);
    if (!parsed) continue;

    const { threshold, direction } = parsed;
    const deviation = ((currentPrice - threshold) / threshold) * 100;

    // Determina qual lado apostar
    const yesLikely = (direction === 'above' && deviation >=  MIN_DEVIATION) ||
                      (direction === 'below' && deviation <= -MIN_DEVIATION);
    const noLikely  = (direction === 'above' && deviation <= -MIN_DEVIATION) ||
                      (direction === 'below' && deviation >=  MIN_DEVIATION);

    if (!yesLikely && !noLikely) {
      console.error(
        `[Finance][${asset.name}] 📊 "${market.question.slice(0, 55)}..." | ` +
        `atual:${currentPrice.toFixed(0)} threshold:${threshold} dev:${deviation >= 0 ? '+' : ''}${deviation.toFixed(1)}% | ❌ sem edge`
      );
      continue;
    }

    const betSide: 'YES' | 'NO' = yesLikely ? 'YES' : 'NO';

    // Tokens: outcomes[0]=YES outcomes[1]=NO
    let tokenIds: string[];
    try {
      tokenIds = typeof market.clobTokenIds === 'string'
        ? JSON.parse(market.clobTokenIds) : market.clobTokenIds;
    } catch { continue; }

    const tokenId = betSide === 'YES' ? tokenIds[0] : tokenIds[1];
    const ob = await getOrderBookData(tokenId);

    if (ob.bestAsk === null || ob.liquidityAtAsk < BET_USDC) {
      console.error(`[Finance][${asset.name}] ⚠️  Sem liquidez (liq:$${ob.liquidityAtAsk.toFixed(2)})`);
      continue;
    }

    const entryPrice = ob.bestAsk;
    const shares     = parseFloat((BET_USDC / entryPrice).toFixed(2));
    const potential  = (BET_USDC * (1 / entryPrice - 1)).toFixed(2);
    const simLabel   = simulate ? '🔔 [SINAL]' : '⚡ [EXECUTADO]';

    console.error(
      `[Finance][${asset.name}] ✅ ENTRADA ${betSide} @ ${(entryPrice*100).toFixed(0)}¢ | ` +
      `${currentPrice.toFixed(0)} ${direction === 'above' ? '>' : '<'} ${threshold} | ` +
      `dev: ${deviation >= 0 ? '+' : ''}${deviation.toFixed(1)}% | ${mins.toFixed(0)}min p/ close`
    );

    entered.add(key);

    if (!simulate) {
      const orderId = await buyShares(client, tokenId, entryPrice, shares, false);
      if (!orderId) {
        console.error(`[Finance][${asset.name}] ⚠️  FOK cancelado`);
        entered.delete(key);
        continue;
      }
      console.error(`[Finance][${asset.name}] 📝 Ordem aceita: ${orderId}`);
    }

    await notify(
      `${simLabel} FINANCE ${asset.name} ${betSide} @ ${(entryPrice*100).toFixed(0)}¢ | dev ${deviation >= 0 ? '+' : ''}${deviation.toFixed(1)}%`,
      [
        `⚡ FINANCE — ${asset.name} ${betSide}`,
        ``,
        `📌 ${market.question}`,
        `📊 Preço atual: ${currentPrice.toFixed(2)} | Threshold: ${threshold.toLocaleString()}`,
        `📈 Desvio: ${deviation >= 0 ? '+' : ''}${deviation.toFixed(2)}% (mín: ${MIN_DEVIATION}%)`,
        `⏱ ${mins.toFixed(0)} min para NYSE fechar (16h ET)`,
        ``,
        `💰 $${BET_USDC} → ${shares} shares @ ${(entryPrice*100).toFixed(0)}¢ | pot: +$${potential}`,
        `📊 Dia Finance: ${dailyPnl >= 0 ? '+' : ''}$${dailyPnl.toFixed(2)}`,
      ].join('\n')
    );

    // Agenda settlement para 1min após fechamento NYSE
    const msToClose = getNYSECloseMs() - Date.now();
    setTimeout(async () => {
      try {
        await settleFinance({
          assetName: asset.name, betSide, entryPrice, shares,
          simulate, marketId: market.conditionId,
        });
      } catch (err) {
        console.error(`[Finance][${asset.name}] Settle error: ${(err as Error).message}`);
      }
    }, msToClose + 60_000);
  }
}

// ── Entry point ────────────────────────────────────────────────────────────
export async function startFinanceScanner(simulate: boolean): Promise<void> {
  const client = createClobClient();
  console.error(
    `[Finance] Iniciando — assets: ${ASSETS.map(a => a.name).join(',')} | ` +
    `desvio mín: ${MIN_DEVIATION}% | janela: ${WINDOW_MIN_MIN}-${WINDOW_MAX_MIN}min p/ close | ` +
    `aposta: $${BET_USDC} | ativo: seg-sex 9h30-16h ET`
  );

  while (true) {
    resetIfNewDay();
    if (isNYSEOpen()) {
      for (const asset of ASSETS) {
        try { await scanAsset(asset, simulate, client); }
        catch (err) { console.error(`[Finance][${asset.name}] Erro: ${(err as Error).message}`); }
        await sleep(500);
      }
    }
    await sleep(SCAN_MS);
  }
}
