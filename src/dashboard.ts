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
  return (p * 100).toFixed(1) + '%';
}

function categoryLabel(cat: string): string {
  const map: Record<string, string> = {
    worldcup: '⚽ Copa',
    elections: '🗳️ Eleições',
    climate: '🌪️ Clima',
    general: '📊 Geral',
  };
  return map[cat] ?? cat;
}

function html(): string {
  const mode = store.simulate ? '🟡 SIMULAÇÃO' : '🟢 PRODUÇÃO';
  const trades = store.trades;
  const valueBets = store.valueBets;
  const profit = store.totalProfit.toFixed(4);

  const priceRows = Object.entries(store.prices).map(([asset, p]) => `
    <tr>
      <td><b>${asset.toUpperCase()}</b></td>
      <td class="up">${formatPrice(p.up)}</td>
      <td class="down">${formatPrice(p.down)}</td>
      <td>${p.up !== null && p.down !== null ? ((p.up + p.down) * 100).toFixed(1) + '%' : '—'}</td>
      <td class="muted">${new Date(p.updatedAt).toLocaleTimeString('pt-BR')}</td>
    </tr>`).join('');

  const tradeRows = trades.length === 0
    ? '<tr><td colspan="7" class="muted center">Nenhuma operação detectada ainda</td></tr>'
    : trades.map(t => `
    <tr>
      <td class="muted">${new Date(t.timestamp).toLocaleString('pt-BR')}</td>
      <td><b>${t.asset.toUpperCase()}</b></td>
      <td class="${t.leg === 'UP' ? 'up' : 'down'}">${t.leg}</td>
      <td>${(t.leg1Price * 100).toFixed(1)}%</td>
      <td>${(t.leg2Price * 100).toFixed(1)}%</td>
      <td>${(t.combined * 100).toFixed(1)}%</td>
      <td class="${t.mode === 'hedge' ? 'profit' : 'loss'}">${
        t.mode === 'hedge'
          ? `+${((1 - t.combined) * 100).toFixed(2)}%`
          : 'Stop-loss'
      }</td>
    </tr>`).join('');

  const valueBetRows = valueBets.length === 0
    ? '<tr><td colspan="8" class="muted center">Aguardando próximo ciclo de análise (a cada 15 min)...</td></tr>'
    : valueBets.map(vb => `
    <tr>
      <td class="muted">${new Date(vb.timestamp).toLocaleString('pt-BR')}</td>
      <td>${categoryLabel(vb.category)}</td>
      <td style="max-width:280px;font-size:0.82rem">${vb.question}</td>
      <td class="muted">${vb.marketProb.toFixed(1)}%</td>
      <td class="up">${vb.aiProb.toFixed(1)}%</td>
      <td class="${vb.edge > 0 ? 'profit' : 'loss'}">${vb.edge > 0 ? '+' : ''}${vb.edge.toFixed(1)}%</td>
      <td style="font-size:0.8rem;font-weight:600;color:${vb.recommendation === 'BUY_YES' ? '#4ade80' : '#f87171'}">${vb.recommendation === 'BUY_YES' ? 'COMPRAR SIM' : 'COMPRAR NÃO'}</td>
      <td class="muted">${vb.confidence.toFixed(0)}%</td>
    </tr>`).join('');

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
    .card { background: #1e2130; border-radius: 10px; padding: 16px 22px; min-width: 160px; }
    .card .label { font-size: 0.75rem; color: #64748b; margin-bottom: 6px; text-transform: uppercase; letter-spacing: .05em; }
    .card .value { font-size: 1.5rem; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; background: #1e2130; border-radius: 10px; overflow: hidden; margin-bottom: 28px; }
    th { background: #161824; padding: 10px 14px; text-align: left; font-size: 0.75rem; color: #64748b; text-transform: uppercase; letter-spacing: .05em; }
    td { padding: 10px 14px; border-top: 1px solid #2d3148; font-size: 0.9rem; }
    .up { color: #4ade80; }
    .down { color: #f87171; }
    .profit { color: #4ade80; font-weight: 600; }
    .loss { color: #f87171; }
    .muted { color: #64748b; }
    .center { text-align: center; padding: 24px; }
    h2 { font-size: 1rem; margin-bottom: 12px; color: #94a3b8; }
    .badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 0.8rem; font-weight: 600; background: #1e2130; }
    .section-header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
    .phase-badge { font-size: 0.7rem; padding: 2px 8px; border-radius: 10px; background: #2d3148; color: #94a3b8; }
  </style>
</head>
<body>
  <h1>Polymarket Arbitrage Bot</h1>
  <p class="subtitle">Atualiza a cada 30 segundos • Modo: <span class="badge">${mode}</span></p>

  <div class="cards">
    <div class="card">
      <div class="label">Status</div>
      <div class="value" style="color:#4ade80">● Online</div>
    </div>
    <div class="card">
      <div class="label">Uptime</div>
      <div class="value">${uptime(store.startedAt)}</div>
    </div>
    <div class="card">
      <div class="label">Hedges (Fase 1)</div>
      <div class="value" style="color:#4ade80">${trades.filter(t => t.mode === 'hedge').length}</div>
    </div>
    <div class="card">
      <div class="label">Value Bets (Fase 2)</div>
      <div class="value" style="color:#f59e0b">${valueBets.length}</div>
    </div>
    <div class="card">
      <div class="label">Stop-losses</div>
      <div class="value" style="color:#f87171">${trades.filter(t => t.mode === 'stop-loss').length}</div>
    </div>
    <div class="card">
      <div class="label">Lucro acumulado</div>
      <div class="value" style="color:${parseFloat(profit) >= 0 ? '#4ade80' : '#f87171'}">$${profit}</div>
    </div>
  </div>

  <div class="section-header">
    <h2>⚡ Fase 1 — Arbitragem BTC/ETH (15m)</h2>
  </div>

  <table>
    <thead><tr><th>Ativo</th><th>UP</th><th>DOWN</th><th>Combinado</th><th>Atualizado</th></tr></thead>
    <tbody>${priceRows || '<tr><td colspan="5" class="muted center">Aguardando dados...</td></tr>'}</tbody>
  </table>

  <table>
    <thead><tr><th>Data/Hora</th><th>Ativo</th><th>Perna</th><th>Leg 1</th><th>Leg 2</th><th>Combinado</th><th>Resultado</th></tr></thead>
    <tbody>${tradeRows}</tbody>
  </table>

  <div class="section-header">
    <h2>🤖 Fase 2 — Value Bets com IA (Copa, Eleições, Clima)</h2>
    <span class="phase-badge">DeepSeek • atualiza a cada 15 min</span>
  </div>

  <table>
    <thead>
      <tr>
        <th>Data/Hora</th>
        <th>Categoria</th>
        <th>Pergunta</th>
        <th>Mercado</th>
        <th>IA (DeepSeek)</th>
        <th>Edge</th>
        <th>Recomendação</th>
        <th>Confiança</th>
      </tr>
    </thead>
    <tbody>${valueBetRows}</tbody>
  </table>
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
    valueBets: store.valueBets.slice(0, 10),
    totalProfit: store.totalProfit,
  }));

  app.listen(port, () => {
    console.error(`[DASHBOARD] Rodando em http://localhost:${port}`);
  });
}
