import express from 'express';
import { store } from './store';

function uptime(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime();
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${m}m`;
}

function formatPrice(p: number | null): string {
  if (p === null) return '—';
  return (p * 100).toFixed(1) + '¢';
}

function html(): string {
  const mode = store.simulate ? '🟡 SIMULAÇÃO' : '🟢 PRODUÇÃO';
  const trades = store.trades;
  const totalPnL = store.totalProfit + store.scalperProfit;

  const priceRows = Object.entries(store.prices).map(([asset, p]) => {
    const combined = p.up !== null && p.down !== null ? p.up + p.down : null;
    const combinedColor = combined !== null ? (combined < 0.95 ? '#4ade80' : combined < 1.0 ? '#f59e0b' : '#f87171') : '';
    return `<tr>
      <td><b>${asset.toUpperCase()}</b></td>
      <td class="up">${formatPrice(p.up)}</td>
      <td class="down">${formatPrice(p.down)}</td>
      <td style="font-weight:700;color:${combinedColor}">${combined !== null ? (combined * 100).toFixed(1) + '¢' : '—'}</td>
      <td class="muted">${new Date(p.updatedAt).toLocaleTimeString('pt-BR')}</td>
    </tr>`;
  }).join('');

  const tradeRows = trades.length === 0
    ? '<tr><td colspan="7" class="muted center">Aguardando primeira operação...</td></tr>'
    : trades.slice(0, 50).map(t => `
    <tr>
      <td class="muted">${new Date(t.timestamp).toLocaleString('pt-BR')}</td>
      <td><b>${t.asset.toUpperCase()}</b></td>
      <td class="${t.leg === 'UP' ? 'up' : 'down'}">${t.leg}</td>
      <td>${(t.leg1Price * 100).toFixed(1)}¢</td>
      <td>${(t.leg2Price * 100).toFixed(1)}¢</td>
      <td style="font-weight:700">${(t.combined * 100).toFixed(1)}¢</td>
      <td class="${t.mode === 'hedge' ? 'profit' : 'loss'}">${
        t.mode === 'hedge' ? `+$${t.profit.toFixed(2)}` : 'Stop-loss'
      }</td>
    </tr>`).join('');

  const scalperRows = store.scalperTrades.length === 0 ? '' :
    store.scalperTrades.slice(0, 30).map(t => {
      const resultCell = !t.settled
        ? `<span style="color:#f59e0b">⏳</span>`
        : t.won
          ? `<span style="color:#4ade80;font-weight:700">✅ GANHOU</span>`
          : `<span style="color:#f87171;font-weight:700">❌ PERDEU</span>`;
      const pnlCell = t.pnl === null
        ? `<span class="muted">—</span>`
        : `<span style="color:${t.pnl >= 0 ? '#4ade80' : '#f87171'};font-weight:700">${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(2)}</span>`;
      return `<tr>
        <td class="muted" style="font-size:0.8rem">${new Date(t.timestamp).toLocaleTimeString('pt-BR')}</td>
        <td><b>${t.asset.toUpperCase()}</b></td>
        <td style="color:${t.side === 'UP' ? '#4ade80' : '#f87171'};font-weight:700">${t.side}</td>
        <td>${(t.entryPrice * 100).toFixed(1)}¢</td>
        <td class="muted">${t.secsAtEntry}s</td>
        <td style="color:#38bdf8">+$${t.potentialProfit.toFixed(2)}</td>
        <td>${resultCell}</td>
        <td>${pnlCell}</td>
      </tr>`;
    }).join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="30">
  <title>Polymarket Bot</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', sans-serif; background: #0f1117; color: #e2e8f0; padding: 24px; }
    h1 { font-size: 1.4rem; margin-bottom: 4px; }
    .subtitle { color: #64748b; font-size: 0.85rem; margin-bottom: 24px; }
    .cards { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 28px; }
    .card { background: #1e2130; border-radius: 10px; padding: 16px 22px; min-width: 150px; }
    .card .label { font-size: 0.72rem; color: #64748b; margin-bottom: 6px; text-transform: uppercase; letter-spacing: .05em; }
    .card .value { font-size: 1.5rem; font-weight: 700; }
    .card .hint { font-size: 0.68rem; color: #475569; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; background: #1e2130; border-radius: 10px; overflow: hidden; margin-bottom: 28px; }
    th { background: #161824; padding: 10px 14px; text-align: left; font-size: 0.72rem; color: #64748b; text-transform: uppercase; letter-spacing: .05em; }
    td { padding: 10px 14px; border-top: 1px solid #2d3148; font-size: 0.9rem; }
    .up { color: #4ade80; }
    .down { color: #f87171; }
    .profit { color: #4ade80; font-weight: 600; }
    .loss { color: #f87171; }
    .muted { color: #64748b; }
    .center { text-align: center; padding: 24px; }
    .section { margin-bottom: 8px; }
    h2 { font-size: 1rem; margin-bottom: 12px; color: #94a3b8; display: flex; align-items: center; gap: 8px; }
    .badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 0.8rem; font-weight: 600; background: #1e2130; }
    .tag { font-size: 0.68rem; padding: 2px 8px; border-radius: 10px; background: #2d3148; color: #64748b; }
    .empty { background: #1e2130; border-radius: 10px; padding: 28px; text-align: center; color: #475569; margin-bottom: 28px; font-size: 0.9rem; }
  </style>
</head>
<body>
  <h1>🤖 Polymarket Crypto Bot</h1>
  <p class="subtitle">Atualiza a cada 30s • Modo: <span class="badge">${mode}</span> • BTC · ETH · SOL · XRP</p>

  <div class="cards">
    <div class="card">
      <div class="label">💰 Saldo Carteira</div>
      <div class="value" style="color:#38bdf8">${store.walletBalance !== null ? '$' + store.walletBalance.toFixed(2) : '…'}</div>
      <div class="hint">${store.walletUpdatedAt ? 'atualizado ' + new Date(store.walletUpdatedAt).toLocaleTimeString('pt-BR') : 'aguardando...'}</div>
    </div>
    <div class="card">
      <div class="label">📈 Lucro Total (bot)</div>
      <div class="value" style="color:${totalPnL >= 0 ? '#4ade80' : '#f87171'}">${totalPnL >= 0 ? '+' : ''}$${totalPnL.toFixed(2)}</div>
      <div class="hint">Fase 1 + Scalper</div>
    </div>
    <div class="card">
      <div class="label">🔁 Hedges (Fase 1)</div>
      <div class="value" style="color:#4ade80">${trades.filter(t => t.mode === 'hedge').length}</div>
      <div class="hint">P&L: +$${store.totalProfit.toFixed(2)}</div>
    </div>
    <div class="card">
      <div class="label">⚡ Scalper (Fase 4)</div>
      <div class="value" style="color:#38bdf8">${store.scalperTrades.length}</div>
      <div class="hint">P&L: ${store.scalperProfit >= 0 ? '+' : ''}$${store.scalperProfit.toFixed(2)}</div>
    </div>
    <div class="card">
      <div class="label">🛑 Stop-losses</div>
      <div class="value" style="color:#f87171">${trades.filter(t => t.mode === 'stop-loss').length}</div>
    </div>
    <div class="card">
      <div class="label">⏱ Online há</div>
      <div class="value">${uptime(store.startedAt)}</div>
    </div>
  </div>

  <div class="section">
    <h2>📊 Preços ao Vivo <span class="tag">atualiza a cada 1s</span></h2>
    <table>
      <thead><tr><th>Ativo</th><th>UP</th><th>DOWN</th><th>Combinado</th><th>Atualizado</th></tr></thead>
      <tbody>${priceRows || '<tr><td colspan="5" class="muted center">Aguardando dados...</td></tr>'}</tbody>
    </table>
  </div>

  <div class="section">
    <h2>🏦 Fase 1 — Dump-Hedge (15 min) <span class="tag">50 shares · meta ≤ 95¢</span></h2>
    <table>
      <thead><tr><th>Data/Hora</th><th>Ativo</th><th>Perna</th><th>Leg 1</th><th>Leg 2</th><th>Combinado</th><th>Resultado</th></tr></thead>
      <tbody>${tradeRows}</tbody>
    </table>
  </div>

  <div class="section">
    <h2>⚡ Fase 4 — Last Minute Scalper (5 min) <span class="tag">80-93¢ · últimos 90s</span></h2>
    ${store.scalperTrades.length === 0
      ? `<div class="empty">⏳ Monitorando mercados de 5 min a cada 12s — aguardando oportunidade com um lado entre 80-93¢ nos últimos 90 segundos.</div>`
      : `<table>
      <thead><tr><th>Hora</th><th>Ativo</th><th>Lado</th><th>Entrada</th><th>Restavam</th><th>Potencial</th><th>Resultado</th><th>P&L</th></tr></thead>
      <tbody>${scalperRows}</tbody>
    </table>`}
  </div>

</body>
</html>`;
}

export function startDashboard(): void {
  const app = express();
  const port = parseInt(process.env.PORT ?? '3000', 10);

  app.get('/', (_req, res) => res.send(html()));
  app.get('/api/status', (_req, res) => res.json({
    status: 'online',
    uptime: uptime(store.startedAt),
    simulate: store.simulate,
    markets: store.markets,
    prices: store.prices,
    trades: store.trades.slice(0, 10),
    totalProfit: store.totalProfit,
    scalperProfit: store.scalperProfit,
    walletBalance: store.walletBalance,
  }));

  app.listen(port, () => {
    console.error(`[DASHBOARD] Rodando em http://localhost:${port}`);
  });
}
