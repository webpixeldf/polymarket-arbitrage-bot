/**
 * Multi-Category Scanner — Near-Certain Resolution
 * Varre TODOS os mercados ativos do Polymarket procurando oportunidades em 88-97¢
 *
 * Verificação por categoria:
 *   Esportes  → ESPN public API (sem auth) — resultado real do jogo
 *   Consensus → 95¢+ AND resolve em ≤4h (sabedoria do mercado)
 *   Crypto/Fin→ 95¢+ AND resolve em ≤2h (módulos específicos cuidam do resto)
 */
import axios from 'axios';
import { config } from './config';
import { buyShares, createClobClient, getOrderBookData } from './api';
import { notify } from './notifier';

// ── Config ─────────────────────────────────────────────────────────────────
const BET_USDC           = parseFloat(process.env.MULTI_BET_USDC          ?? '1');
const MIN_PRICE          = parseFloat(process.env.MULTI_MIN_PRICE         ?? '0.88');
const MAX_PRICE          = parseFloat(process.env.MULTI_MAX_PRICE         ?? '0.97');
const MAX_HOURS          = parseFloat(process.env.MULTI_MAX_HOURS         ?? '24');
const CONSENSUS_MIN      = parseFloat(process.env.MULTI_CONSENSUS_MIN     ?? '0.95');
const CONSENSUS_MAX_HOURS= parseFloat(process.env.MULTI_CONSENSUS_HOURS   ?? '12');
const CRYPTO_FIN_MAX_H   = parseFloat(process.env.MULTI_CRYPTOFIN_HOURS   ?? '2');
const SCAN_INTERVAL      = 5 * 60_000; // scan a cada 5 minutos

// ── Tipos ──────────────────────────────────────────────────────────────────
type Category = 'sports' | 'crypto' | 'finance' | 'consensus';

interface ESPNGame {
  name: string;
  completed: boolean;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  winner: string | null;
}

// ── ESPN API (pública, sem autenticação) ────────────────────────────────────
const ESPN_SPORTS = [
  { sport: 'soccer',     league: 'all'  },
  { sport: 'basketball', league: 'nba'  },
  { sport: 'football',   league: 'nfl'  },
  { sport: 'baseball',   league: 'mlb'  },
  { sport: 'hockey',     league: 'nhl'  },
];

let espnCache: { games: ESPNGame[]; ts: number } = { games: [], ts: 0 };

async function fetchESPNGames(): Promise<ESPNGame[]> {
  if (Date.now() - espnCache.ts < 3 * 60_000) return espnCache.games;

  const games: ESPNGame[] = [];
  for (const { sport, league } of ESPN_SPORTS) {
    try {
      const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${league}/scoreboard`;
      const resp = await axios.get(url, { timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0' } });
      for (const ev of resp.data?.events ?? []) {
        const comp = ev.competitions?.[0];
        if (!comp?.competitors || comp.competitors.length < 2) continue;
        const home = comp.competitors.find((c: any) => c.homeAway === 'home');
        const away = comp.competitors.find((c: any) => c.homeAway === 'away');
        if (!home || !away) continue;
        const completed  = ev.status?.type?.completed ?? false;
        const homeScore  = parseFloat(home.score ?? '0');
        const awayScore  = parseFloat(away.score ?? '0');
        const homeTeam   = home.team?.displayName ?? '';
        const awayTeam   = away.team?.displayName ?? '';
        let winner: string | null = null;
        if (completed && homeScore !== awayScore) {
          winner = homeScore > awayScore ? homeTeam : awayTeam;
        }
        games.push({ name: ev.name ?? '', completed, homeTeam, awayTeam, homeScore, awayScore, winner });
      }
    } catch {}
    await sleep(200);
  }

  espnCache = { games, ts: Date.now() };
  console.error(`[Multi] ESPN: ${games.length} jogos (${games.filter(g => g.completed).length} concluídos)`);
  return games;
}

// ── Matching de times ───────────────────────────────────────────────────────
function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function teamTokens(name: string): string[] {
  return normalize(name).split(' ').filter(w => w.length >= 4);
}

function teamInQuestion(teamName: string, question: string): boolean {
  const tt = teamTokens(teamName);
  const qt = normalize(question).split(' ');
  return tt.length > 0 && tt.some(t => qt.includes(t));
}

interface SportsCheck { verified: boolean; betSide: 'YES' | 'NO' | null; reason: string; }

function checkSportsResult(question: string, games: ESPNGame[]): SportsCheck {
  const q = normalize(question);
  const isWinQ = /\b(beat|win|defeat|advance|qualify|champion|title)\b/.test(q);
  if (!isWinQ) return { verified: false, betSide: null, reason: 'Pergunta não é sobre vitória' };

  for (const g of games) {
    if (!g.completed) continue;
    const homeIn = teamInQuestion(g.homeTeam, question);
    const awayIn = teamInQuestion(g.awayTeam, question);
    if (!homeIn && !awayIn) continue;

    if (g.winner === null) {
      return { verified: false, betSide: null, reason: `Empate: ${g.homeTeam} ${g.homeScore}×${g.awayScore} ${g.awayTeam}` };
    }

    // Sujeito da pergunta: time mencionado antes de "beat/win"
    const subjectIsHome = homeIn && !awayIn;
    const subjectIsAway = awayIn && !homeIn;

    if (subjectIsHome || subjectIsAway) {
      const subject  = subjectIsHome ? g.homeTeam : g.awayTeam;
      const won      = g.winner === subject;
      const score    = subjectIsHome
        ? `${g.homeScore}×${g.awayScore}` : `${g.awayScore}×${g.homeScore}`;
      return {
        verified: true,
        betSide : won ? 'YES' : 'NO',
        reason  : `${subject} ${won ? 'ganhou' : 'perdeu'} ${score}`,
      };
    }
  }
  return { verified: false, betSide: null, reason: 'Jogo não encontrado na ESPN' };
}

// ── Detecção de categoria ───────────────────────────────────────────────────
function detectCategory(question: string, tags: string[]): Category {
  const q = question.toLowerCase();
  const t = tags.join(' ').toLowerCase();

  if (/\b(bitcoin|btc|ethereum|eth|solana|sol|xrp|doge|crypto)\b/.test(q)) return 'crypto';
  if (/\b(s&p|sp500|nasdaq|dow|gold|oil|fed|fomc|treasury|stock)\b/.test(q)) return 'finance';
  if (/\b(beat|win|defeat|advance|qualify|champion|playoff|final|match|game|tournament|league|cup|nfl|nba|mlb|nhl|premier|fifa|uefa|la liga|serie a)\b/.test(q)
      || t.includes('sport') || t.includes('esport') || t.includes('soccer') || t.includes('football')) {
    return 'sports';
  }
  return 'consensus';
}

// ── Estado ─────────────────────────────────────────────────────────────────
const entered   = new Set<string>();
let dailyPnl    = 0; let dailyTrades = 0; let dailyWins = 0;
let dailyDate   = new Date().toDateString();

function resetIfNewDay(): void {
  const today = new Date().toDateString();
  if (today !== dailyDate) {
    dailyDate = today; dailyPnl = 0; dailyTrades = 0; dailyWins = 0;
    entered.clear();
    console.error('[Multi] Novo dia — contadores resetados');
  }
}

function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

// ── Settle ─────────────────────────────────────────────────────────────────
async function settle(params: {
  label: string; betSide: 'YES' | 'NO'; category: string;
  entryPrice: number; shares: number; simulate: boolean; marketId: string;
}): Promise<void> {
  const { label, betSide, category, entryPrice, shares, simulate, marketId } = params;

  await sleep(30_000);

  let won: boolean | null = null;
  try {
    const resp = await axios.get(`${config.gammaApiUrl}/markets`, {
      params: { conditionId: marketId, limit: 1 },
      timeout: 8000,
    });
    const list = Array.isArray(resp.data) ? resp.data : [];
    const m = list.find((x: any) => x.conditionId === marketId) ?? list[0];
    if (m?.outcomePrices) {
      const prices = typeof m.outcomePrices === 'string' ? JSON.parse(m.outcomePrices) : m.outcomePrices;
      const yesP = parseFloat(prices[0]);
      const noP  = parseFloat(prices[1]);
      if (!isNaN(yesP)) {
        won = betSide === 'YES' ? yesP > noP : noP > yesP;
        console.error(`[Multi][${label}] 📡 Gamma: YES=${(yesP*100).toFixed(0)}¢ NO=${(noP*100).toFixed(0)}¢ → ${won ? 'WIN' : 'LOSS'}`);
      }
    }
  } catch {}

  if (won === null) won = false;

  const pnl = won ? BET_USDC * (1 / entryPrice - 1) : -BET_USDC;
  dailyPnl += pnl; dailyTrades++;
  if (won) dailyWins++;

  const winRate = (dailyWins / dailyTrades * 100).toFixed(0);
  console.error(
    `[Multi][${label}] ${won ? '✅ WIN' : '❌ LOSS'} [${category}] | ` +
    `PnL: ${pnl > 0 ? '+' : ''}$${pnl.toFixed(2)} | Dia: ${dailyPnl >= 0 ? '+' : ''}$${dailyPnl.toFixed(2)} | ${winRate}% (${dailyWins}/${dailyTrades})`
  );

  await notify(
    `${simulate ? '[SIM] ' : ''}${won ? '✅ WIN' : '❌ LOSS'} MULTI ${label} | ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} | Dia: ${dailyPnl >= 0 ? '+' : ''}$${dailyPnl.toFixed(2)}`,
    [
      won ? `✅ GANHOU! +$${pnl.toFixed(2)}` : `❌ PERDEU $${Math.abs(pnl).toFixed(2)}`,
      `${label} ${betSide} [${category}] @ ${(entryPrice*100).toFixed(0)}¢`,
      `📊 Hoje (Multi): ${dailyPnl >= 0 ? '+' : ''}$${dailyPnl.toFixed(2)} | ${dailyWins}/${dailyTrades} (${winRate}%)`,
    ].join('\n')
  );
}

// ── Ciclo principal ─────────────────────────────────────────────────────────
async function fetchAllMarkets(): Promise<any[]> {
  const all: any[] = [];
  let offset = 0;
  const limit = 100;
  while (true) {
    try {
      const resp = await axios.get(`${config.gammaApiUrl}/markets`, {
        params: { active: true, limit, offset, order: 'volume', ascending: false },
        timeout: 15000,
      });
      const batch: any[] = resp.data ?? [];
      all.push(...batch);
      if (batch.length < limit || all.length >= 600) break;
      offset += limit;
      await sleep(400);
    } catch (err) {
      console.error(`[Multi] Erro ao buscar mercados (offset ${offset}): ${(err as Error).message}`);
      break;
    }
  }
  return all;
}

async function scanAll(simulate: boolean, client: ReturnType<typeof createClobClient>): Promise<void> {
  // 1. Todos os mercados ativos com paginação (até 600)
  const allMarkets = await fetchAllMarkets();
  if (allMarkets.length === 0) {
    console.error('[Multi] Nenhum mercado retornado pela API');
    return;
  }

  const now = Date.now();

  // 2. Pré-filtra por data + preço estimado via outcomePrices da Gamma
  const candidates = allMarkets.filter(m => {
    if (!m.conditionId || !m.endDate || !m.clobTokenIds) return false;
    const endMs = new Date(m.endDate).getTime();
    if (endMs < now || endMs > now + MAX_HOURS * 3_600_000) return false;
    if (entered.has(`multi-${m.conditionId}`)) return false;

    // outcomePrices pode estar disponível (Gamma retorna preço atual)
    if (m.outcomePrices) {
      try {
        const prices = typeof m.outcomePrices === 'string' ? JSON.parse(m.outcomePrices) : m.outcomePrices;
        const yesP = parseFloat(prices[0]);
        const noP  = parseFloat(prices[1]);
        const maxP = Math.max(yesP, noP);
        return maxP >= MIN_PRICE && maxP <= MAX_PRICE;
      } catch {}
    }
    return true; // sem outcomePrices: inclui para checagem via CLOB
  });

  // 3. ESPN
  const espnGames = await fetchESPNGames();

  let checked = 0, entries = 0;

  for (const market of candidates) {
    const key      = `multi-${market.conditionId}`;
    const endMs    = new Date(market.endDate).getTime();
    const hoursLeft = (endMs - now) / 3_600_000;
    const question  = market.question ?? '';
    const tags      = market.tags ?? [];
    const category  = detectCategory(question, tags);

    // 4. Verificação por categoria (antes de checar CLOB — economiza chamadas)
    let preSideHint: 'YES' | 'NO' | null = null;
    let verifyReason = '';
    let preVerified  = false;

    if (category === 'sports') {
      const check = checkSportsResult(question, espnGames);
      if (!check.verified) continue;
      preSideHint = check.betSide;
      verifyReason = check.reason;
      preVerified  = true;
    } else if (category === 'consensus') {
      if (hoursLeft > CONSENSUS_MAX_HOURS) continue;
    } else if (category === 'crypto' || category === 'finance') {
      if (hoursLeft > CRYPTO_FIN_MAX_H) continue;
    }

    // 5. Order book real (CLOB)
    let tokenIds: string[];
    try { tokenIds = typeof market.clobTokenIds === 'string' ? JSON.parse(market.clobTokenIds) : market.clobTokenIds; }
    catch { continue; }
    const [yesTokenId, noTokenId] = tokenIds;

    // Para sports: checa apenas o lado indicado pelo ESPN
    let betSide: 'YES' | 'NO' | null = null;
    let tokenId!: string;
    let entryPrice!: number;

    if (preVerified && preSideHint) {
      const tid = preSideHint === 'YES' ? yesTokenId : noTokenId;
      const ob  = await getOrderBookData(tid);
      await sleep(150);
      checked++;
      if (ob.bestAsk === null) {
        console.error(`[Multi] ⏭  Sem ask no CLOB: "${question.slice(0,50)}"`);
        continue;
      }
      if (ob.bestAsk < MIN_PRICE || ob.bestAsk > MAX_PRICE) {
        console.error(`[Multi] ⏭  Preço fora da faixa: ${(ob.bestAsk*100).toFixed(0)}¢ (${(MIN_PRICE*100).toFixed(0)}-${(MAX_PRICE*100).toFixed(0)}¢) | "${question.slice(0,40)}"`);
        continue;
      }
      if (ob.liquidityAtAsk < BET_USDC) {
        console.error(`[Multi] ⏭  Liquidez insuficiente: $${ob.liquidityAtAsk.toFixed(2)} < $${BET_USDC} | "${question.slice(0,40)}"`);
        continue;
      }
      betSide    = preSideHint;
      tokenId    = tid;
      entryPrice = ob.bestAsk;
    } else {
      // Consensus/crypto/finance: checa ambos os lados
      const [yesOb, noOb] = await Promise.all([
        getOrderBookData(yesTokenId),
        getOrderBookData(noTokenId),
      ]);
      await sleep(150);
      checked++;

      const minP = Math.max(MIN_PRICE, CONSENSUS_MIN);
      const yesOk = yesOb.bestAsk !== null && yesOb.bestAsk >= minP && yesOb.bestAsk <= MAX_PRICE && yesOb.liquidityAtAsk >= BET_USDC;
      const noOk  = noOb.bestAsk  !== null && noOb.bestAsk  >= minP && noOb.bestAsk  <= MAX_PRICE && noOb.liquidityAtAsk  >= BET_USDC;

      if (yesOk) {
        betSide = 'YES'; tokenId = yesTokenId; entryPrice = yesOb.bestAsk!;
        verifyReason = `Consenso ${(yesOb.bestAsk!*100).toFixed(0)}¢ | resolve em ${hoursLeft.toFixed(1)}h`;
      } else if (noOk) {
        betSide = 'NO'; tokenId = noTokenId; entryPrice = noOb.bestAsk!;
        verifyReason = `Consenso ${(noOb.bestAsk!*100).toFixed(0)}¢ | resolve em ${hoursLeft.toFixed(1)}h`;
      } else {
        // Log diagnóstico
        const yP = yesOb.bestAsk !== null ? `YES:${(yesOb.bestAsk*100).toFixed(0)}¢ liq:$${yesOb.liquidityAtAsk.toFixed(1)}` : 'YES:sem ask';
        const nP = noOb.bestAsk  !== null ? `NO:${(noOb.bestAsk*100).toFixed(0)}¢ liq:$${noOb.liquidityAtAsk.toFixed(1)}`   : 'NO:sem ask';
        console.error(`[Multi] ⏭  CLOB fora da faixa ${(minP*100).toFixed(0)}-${(MAX_PRICE*100).toFixed(0)}¢ | ${yP} | ${nP} | "${question.slice(0,40)}"`);
        continue;
      }
    }

    // ── ENTRADA ──
    entries++;
    entered.add(key);

    const shares    = parseFloat((BET_USDC / entryPrice).toFixed(2));
    const potential = (BET_USDC * (1 / entryPrice - 1)).toFixed(2);
    const label     = question.slice(0, 45);
    const simLabel  = simulate ? '🔔 [SINAL]' : '⚡ [EXECUTADO]';

    console.error(
      `[Multi] ✅ ${betSide} @ ${(entryPrice*100).toFixed(0)}¢ [${category}] | "${label}..." | ${verifyReason}`
    );

    if (!simulate) {
      // slippage de 3¢ para absorver movimentação entre leitura e execução
      const orderId = await buyShares(client, tokenId, entryPrice, shares, false, 0.03);
      if (!orderId) {
        console.error(`[Multi] ⚠️  FOK cancelado (sem contraparte): ${label}`);
        entered.delete(key);
        continue;
      }
      console.error(`[Multi] 📝 Ordem aceita: ${orderId}`);
    }

    await notify(
      `${simLabel} MULTI ${betSide} @ ${(entryPrice*100).toFixed(0)}¢ [${category}] | pot: +$${potential}`,
      [
        `⚡ MULTI-CATEGORY — ${category.toUpperCase()}`,
        ``,
        `📌 ${question}`,
        `✅ ${verifyReason}`,
        `⏱ Resolve em ${hoursLeft.toFixed(1)}h`,
        ``,
        `💰 ${betSide} @ ${(entryPrice*100).toFixed(0)}¢ | $${BET_USDC} → ${shares} shares | pot: +$${potential}`,
        `📊 Dia Multi: ${dailyPnl >= 0 ? '+' : ''}$${dailyPnl.toFixed(2)}`,
      ].join('\n')
    );

    // Agenda settle para 90s após resolução
    const msToEnd = endMs - Date.now();
    setTimeout(async () => {
      try {
        await settle({ label, betSide: betSide!, category, entryPrice, shares, simulate, marketId: market.conditionId });
      } catch (err) {
        console.error(`[Multi] Settle error: ${(err as Error).message}`);
      }
    }, msToEnd + 90_000);
  }

  console.error(
    `[Multi] Scan: ${allMarkets.length} mercados → ${candidates.length} candidatos → ${checked} verificados → ${entries} entradas`
  );
}

// ── Entry point ────────────────────────────────────────────────────────────
export async function startMultiScanner(simulate: boolean): Promise<void> {
  const client = createClobClient();
  console.error(
    `[Multi] Iniciando — faixa: ${(MIN_PRICE*100).toFixed(0)}-${(MAX_PRICE*100).toFixed(0)}¢ | ` +
    `consensus: ≤${CONSENSUS_MAX_HOURS}h mín ${(CONSENSUS_MIN*100).toFixed(0)}¢ | ` +
    `crypto/fin: ≤${CRYPTO_FIN_MAX_H}h | aposta: $${BET_USDC} | scan: 5min`
  );

  while (true) {
    resetIfNewDay();
    try { await scanAll(simulate, client); }
    catch (err) { console.error(`[Multi] Erro crítico: ${(err as Error).message}`); }
    await sleep(SCAN_INTERVAL);
  }
}
