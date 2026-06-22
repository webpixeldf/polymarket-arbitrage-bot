#!/usr/bin/env node
/**
 * Backtest — analisa data/trades.jsonl e imprime métricas completas
 * Uso: npx ts-node src/backtest.ts
 */
import * as fs from 'fs';
import * as path from 'path';

const TRADES_LOG = path.join(process.cwd(), 'data', 'trades.jsonl');

interface TradeRecord {
  timestamp: string;
  asset: string;
  marketId: string;
  side: string;
  entryPrice: number;
  exitPrice: number;
  exitReason: string;
  secsLeft: number;
  shares: number;
  volume: number;
  liquidity: number;
  spread: number | null;
  score: number;
  won: boolean;
  pnl: number;
  roi: number;
  simulate: boolean;
}

function readTrades(): TradeRecord[] {
  if (!fs.existsSync(TRADES_LOG)) {
    console.log('Arquivo de trades não encontrado:', TRADES_LOG);
    process.exit(0);
  }
  return fs
    .readFileSync(TRADES_LOG, 'utf8')
    .split('\n')
    .filter(l => l.trim())
    .map(l => JSON.parse(l) as TradeRecord);
}

function calcMetrics(trades: TradeRecord[], label: string): void {
  if (trades.length === 0) {
    console.log(`\n[${label}] Nenhum trade registrado.`);
    return;
  }

  const wins    = trades.filter(t => t.won).length;
  const losses  = trades.length - wins;
  const winRate = (wins / trades.length * 100).toFixed(1);

  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
  const betBase  = trades.length * 5; // $5 por trade (BET_USDC padrão)
  const roiPct   = (totalPnl / betBase * 100).toFixed(1);

  // Drawdown máximo (equity curve)
  let peak = 0, equity = 0, maxDD = 0;
  for (const t of trades) {
    equity += t.pnl;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDD) maxDD = dd;
  }

  // Profit factor
  const grossProfit = trades.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
  const grossLoss   = trades.filter(t => t.pnl < 0).reduce((s, t) => s + Math.abs(t.pnl), 0);
  const pf          = grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : '∞';

  // Expectativa matemática por trade
  const expectation = (totalPnl / trades.length).toFixed(4);

  // Sharpe ratio (simplificado: retorno médio / desvio padrão dos retornos)
  const pnls   = trades.map(t => t.pnl);
  const avgPnl = totalPnl / trades.length;
  const variance = pnls.reduce((s, p) => s + Math.pow(p - avgPnl, 2), 0) / trades.length;
  const stdDev   = Math.sqrt(variance);
  const sharpe   = stdDev > 0 ? (avgPnl / stdDev).toFixed(2) : 'N/A';

  // Por ativo
  const byAsset: Record<string, { w: number; n: number; pnl: number }> = {};
  for (const t of trades) {
    if (!byAsset[t.asset]) byAsset[t.asset] = { w: 0, n: 0, pnl: 0 };
    byAsset[t.asset].n++;
    if (t.won) byAsset[t.asset].w++;
    byAsset[t.asset].pnl += t.pnl;
  }

  // Por razão de saída
  const byReason: Record<string, { n: number; pnl: number }> = {};
  for (const t of trades) {
    const r = t.exitReason;
    if (!byReason[r]) byReason[r] = { n: 0, pnl: 0 };
    byReason[r].n++;
    byReason[r].pnl += t.pnl;
  }

  // Score médio
  const avgScore = (trades.reduce((s, t) => s + t.score, 0) / trades.length).toFixed(1);
  const minScore = Math.min(...trades.map(t => t.score));
  const maxScore = Math.max(...trades.map(t => t.score));

  // Spread médio
  const spreadsKnown = trades.filter(t => t.spread !== null).map(t => t.spread as number);
  const avgSpread = spreadsKnown.length ? (spreadsKnown.reduce((a, b) => a + b, 0) / spreadsKnown.length * 100).toFixed(2) : 'N/A';

  console.log('\n' + '═'.repeat(58));
  console.log(`  BACKTEST — LAST_MINUTE_5M_CONVERGENCE [${label}]`);
  console.log('═'.repeat(58));
  console.log(`  Trades totais:     ${trades.length} (${wins} wins / ${losses} losses)`);
  console.log(`  Taxa de acerto:    ${winRate}%`);
  console.log(`  Lucro líquido:     ${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`);
  console.log(`  ROI (vs capital):  ${roiPct}%`);
  console.log(`  Max drawdown:      -$${maxDD.toFixed(2)}`);
  console.log(`  Profit factor:     ${pf}`);
  console.log(`  Expectativa/trade: $${expectation}`);
  console.log(`  Sharpe ratio:      ${sharpe}`);
  console.log(`  Score médio:       ${avgScore} (min ${minScore} / max ${maxScore})`);
  console.log(`  Spread médio:      ${avgSpread}¢`);
  console.log('');
  console.log('  ── Por ativo ──────────────────────────────');
  for (const [a, s] of Object.entries(byAsset).sort((x, y) => y[1].pnl - x[1].pnl)) {
    const wr = (s.w / s.n * 100).toFixed(0);
    console.log(`  ${a.padEnd(6)}  ${s.w}/${s.n} (${wr}%)  P&L: ${s.pnl >= 0 ? '+' : ''}$${s.pnl.toFixed(2)}`);
  }
  console.log('');
  console.log('  ── Saídas ─────────────────────────────────');
  for (const [r, s] of Object.entries(byReason)) {
    console.log(`  ${r.padEnd(18)}  ${s.n}x  P&L: ${s.pnl >= 0 ? '+' : ''}$${s.pnl.toFixed(2)}`);
  }
  console.log('═'.repeat(58) + '\n');
}

const all    = readTrades();
const real   = all.filter(t => !t.simulate);
const sim    = all.filter(t => t.simulate);

if (real.length > 0) calcMetrics(real, 'PRODUÇÃO');
if (sim.length  > 0) calcMetrics(sim,  'SIMULAÇÃO');
if (all.length  === 0) {
  console.log('\nNenhum trade registrado em', TRADES_LOG);
  console.log('O bot precisa operar ao menos uma vez para gerar dados de backtest.\n');
}
