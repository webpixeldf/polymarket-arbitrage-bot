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
    worldcup: '⚽ Copa do Mundo',
    elections: '🗳️ Eleições',
    climate: '🌪️ Clima',
    politics: '🏛️ Política',
    finance: '💹 Finanças',
    geopolitics: '🌍 Geopolítica',
    sports: '🏆 Esportes',
    tech: '🤖 Tecnologia',
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
        t.mode === 'hedge' ? `+${((1 - t.combined) * 100).toFixed(2)}%` : 'Stop-loss'
      }</td>
    </tr>`).join('');

  const valueBetCards = valueBets.length === 0
    ? `<div class="empty-state">⏳ Aguardando próximo ciclo de análise (a cada 15 min)...<br><span class="muted" style="font-size:0.8rem">O DeepSeek analisa mercados de Copa do Mundo, Eleições, Clima, Política e Geopolítica</span></div>`
    : valueBets.map(vb => {
        const edgeColor = vb.edge > 0 ? '#4ade80' : '#f87171';
        const recColor = vb.recommendation === 'BUY_YES' ? '#4ade80' : '#f87171';
        const recLabel = vb.recommendation === 'BUY_YES' ? '✅ COMPRAR SIM (YES)' : '❌ COMPRAR NÃO (NO)';
        const bullish = (vb.bullishFactors ?? []).map(f => `<li>${f}</li>`).join('');
        const bearish = (vb.bearishFactors ?? []).map(f => `<li>${f}</li>`).join('');
        return `
    <div class="vb-card">
      <div class="vb-header">
        <span class="cat-badge">${categoryLabel(vb.category)}</span>
        <span class="vb-time muted">${new Date(vb.timestamp).toLocaleString('pt-BR')}</span>
      </div>
      <div class="vb-question">${vb.questionPT || vb.question}</div>
      <div class="vb-question-en muted">${vb.question}</div>

      <div class="vb-stats">
        <div class="vb-stat">
          <div class="vb-stat-label">Mercado diz</div>
          <div class="vb-stat-value muted">${vb.marketProb.toFixed(1)}%</div>
        </div>
        <div class="vb-stat">
          <div class="vb-stat-label">IA diz</div>
          <div class="vb-stat-value up">${vb.aiProb.toFixed(1)}%</div>
        </div>
        <div class="vb-stat">
          <div class="vb-stat-label">Vantagem (Edge)</div>
          <div class="vb-stat-value" style="color:${edgeColor}">${vb.edge > 0 ? '+' : ''}${vb.edge.toFixed(1)}%</div>
        </div>
        <div class="vb-stat">
          <div class="vb-stat-label">Confiança da IA</div>
          <div class="vb-stat-value">${vb.confidence.toFixed(0)}%</div>
        </div>
      </div>

      <div class="vb-rec" style="color:${recColor}">${recLabel}</div>

      <div class="vb-reasoning">${vb.reasoning}</div>

      ${bullish || bearish ? `
      <div class="vb-factors">
        ${bullish ? `<div class="factors-col"><div class="factors-title up">✅ Favorável ao SIM</div><ul>${bullish}</ul></div>` : ''}
        ${bearish ? `<div class="factors-col"><div class="factors-title down">❌ Favorável ao NÃO</div><ul>${bearish}</ul></div>` : ''}
      </div>` : ''}

      <a class="vb-link" href="https://polymarket.com/event/${vb.eventSlug}" target="_blank">🔗 Ver no Polymarket</a>
    </div>`;
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
    .section-header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
    .phase-badge { font-size: 0.7rem; padding: 2px 8px; border-radius: 10px; background: #2d3148; color: #94a3b8; }
    .empty-state { background: #1e2130; border-radius: 10px; padding: 32px; text-align: center; color: #64748b; margin-bottom: 28px; line-height: 2; }

    /* Value Bet Cards */
    .vb-card { background: #1e2130; border-radius: 12px; padding: 20px; margin-bottom: 16px; border-left: 3px solid #f59e0b; }
    .vb-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
    .cat-badge { font-size: 0.8rem; padding: 3px 10px; background: #2d3148; border-radius: 20px; }
    .vb-time { font-size: 0.78rem; }
    .vb-question { font-size: 1.05rem; font-weight: 600; margin-bottom: 4px; line-height: 1.4; }
    .vb-question-en { font-size: 0.78rem; margin-bottom: 14px; font-style: italic; }
    .vb-stats { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 14px; }
    .vb-stat { background: #161824; border-radius: 8px; padding: 10px 16px; min-width: 100px; }
    .vb-stat-label { font-size: 0.7rem; color: #64748b; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 4px; }
    .vb-stat-value { font-size: 1.3rem; font-weight: 700; }
    .vb-rec { font-size: 1rem; font-weight: 700; margin-bottom: 10px; padding: 8px 14px; background: #161824; border-radius: 8px; display: inline-block; }
    .vb-reasoning { font-size: 0.88rem; color: #cbd5e1; line-height: 1.6; margin: 10px 0; padding: 12px; background: #161824; border-radius: 8px; }
    .vb-factors { display: flex; gap: 16px; margin-top: 12px; flex-wrap: wrap; }
    .factors-col { flex: 1; min-width: 200px; }
    .factors-title { font-size: 0.78rem; font-weight: 600; margin-bottom: 6px; }
    .factors-col ul { list-style: none; }
    .factors-col ul li { font-size: 0.82rem; color: #94a3b8; padding: 3px 0; padding-left: 8px; border-left: 2px solid #2d3148; margin-bottom: 4px; }
    .vb-link { display: inline-block; margin-top: 14px; font-size: 0.82rem; color: #6366f1; text-decoration: none; }
    .vb-link:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>🤖 Polymarket Arbitrage Bot</h1>
  <p class="subtitle">Atualiza a cada 30 segundos • Modo: <span class="badge">${mode}</span></p>

  <div class="cards">
    <div class="card">
      <div class="label">Status</div>
      <div class="value" style="color:#4ade80">● Online</div>
    </div>
    <div class="card">
      <div class="label">Tempo online</div>
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
      <div class="label">Cross-Arb (Fase 3)</div>
      <div class="value" style="color:#a78bfa">${store.crossArbOpportunities.length}</div>
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
    <h2>⚡ Fase 1 — Arbitragem BTC/ETH (15 minutos)</h2>
  </div>

  <table>
    <thead><tr><th>Ativo</th><th>Subida</th><th>Queda</th><th>Combinado</th><th>Atualizado</th></tr></thead>
    <tbody>${priceRows || '<tr><td colspan="5" class="muted center">Aguardando dados...</td></tr>'}</tbody>
  </table>

  <table>
    <thead><tr><th>Data/Hora</th><th>Ativo</th><th>Perna</th><th>Leg 1</th><th>Leg 2</th><th>Combinado</th><th>Resultado</th></tr></thead>
    <tbody>${tradeRows}</tbody>
  </table>

  <div class="section-header">
    <h2>🤖 Fase 2 — Apostas de Valor com IA</h2>
    <span class="phase-badge">DeepSeek • Copa, Eleições, Clima, Política • atualiza a cada 15 min</span>
  </div>

  ${valueBetCards}

  <div class="section-header" style="margin-top:8px">
    <h2>💸 Ordens Executadas</h2>
    <span class="phase-badge">${process.env.ENABLE_PHASE2_ORDERS === 'true' ? '🟢 Auto-execução ATIVA' : '🔴 Auto-execução DESATIVADA'}</span>
  </div>

  ${store.orders.length === 0
    ? `<div class="empty-state">${process.env.ENABLE_PHASE2_ORDERS === 'true' ? 'Nenhuma ordem executada ainda — aguardando próximo value bet.' : 'Para ativar, adicione <b>ENABLE_PHASE2_ORDERS=true</b> e <b>MAX_BET_USDC=5</b> no Railway.'}</div>`
    : `<table>
    <thead><tr>
      <th>Horário</th><th>Mercado</th><th>Lado</th><th>Preço</th><th>Valor</th><th>Edge</th><th>Status</th>
    </tr></thead>
    <tbody>
      ${store.orders.map(o => `<tr>
        <td class="muted" style="font-size:0.8rem">${new Date(o.timestamp).toLocaleString('pt-BR')}</td>
        <td style="font-size:0.8rem;max-width:260px" title="${o.question}">${o.questionPT || o.question}</td>
        <td style="font-weight:700;color:${o.side==='YES'?'#4ade80':'#f87171'}">${o.side}</td>
        <td>${(o.price*100).toFixed(1)}¢</td>
        <td>$${o.amountUsdc.toFixed(2)}</td>
        <td style="font-weight:600;color:${o.edge>0?'#4ade80':'#f87171'}">${o.edge>0?'+':''}${o.edge.toFixed(1)}%</td>
        <td>${o.orderId ? (o.simulate ? '🟡 SIM' : '✅ OK') : '❌ Falhou'}</td>
      </tr>`).join('')}
    </tbody>
  </table>`}

  <div class="section-header" style="margin-top:8px">
    <h2>🔬 Análise Completa da IA — Último Ciclo</h2>
    <span class="phase-badge">${store.lastScanAt ? 'Último scan: ' + new Date(store.lastScanAt).toLocaleTimeString('pt-BR') : 'Aguardando primeiro scan...'}</span>
  </div>

  ${store.analyzedMarkets.length === 0
    ? `<div class="empty-state">Aguardando primeiro ciclo de análise...</div>`
    : `<table>
    <thead>
      <tr>
        <th>Categoria</th>
        <th>Pergunta (PT)</th>
        <th>Mercado</th>
        <th>IA</th>
        <th>Edge</th>
        <th>Conf.</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      ${store.analyzedMarkets.map(m => {
        const absEdge = Math.abs(m.edge);
        const edgeColor = absEdge >= 5 ? (m.edge > 0 ? '#4ade80' : '#f87171') : absEdge >= 2 ? '#f59e0b' : '#64748b';
        const status = m.isValueBet
          ? `<span style="color:${m.edge>0?'#4ade80':'#f87171'};font-weight:700">🔴 VALUE BET</span>`
          : absEdge >= 2
            ? `<span style="color:#f59e0b">🟡 Fraco</span>`
            : `<span class="muted">⚪ Neutro</span>`;
        return `<tr>
          <td style="font-size:0.8rem">${categoryLabel(m.category)}</td>
          <td style="font-size:0.82rem;max-width:300px">
            <a href="https://polymarket.com/event/${m.eventSlug}" target="_blank" style="color:#e2e8f0;text-decoration:none" title="${m.question}">${m.questionPT || m.question}</a>
          </td>
          <td class="muted">${m.marketProb.toFixed(1)}%</td>
          <td class="${m.aiProb > m.marketProb ? 'up' : m.aiProb < m.marketProb ? 'down' : 'muted'}">${m.aiProb.toFixed(1)}%</td>
          <td style="font-weight:600;color:${edgeColor}">${m.edge > 0 ? '+' : ''}${m.edge.toFixed(1)}%</td>
          <td class="muted">${m.confidence.toFixed(0)}%</td>
          <td>${status}</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>`}


  <div class="section-header" style="margin-top:8px">
    <h2>🔀 Fase 3 — Arbitragem Cross-Platform (Kalshi × Polymarket)</h2>
    <span class="phase-badge">${store.lastCrossArbScanAt ? 'Último scan: ' + new Date(store.lastCrossArbScanAt).toLocaleTimeString('pt-BR') : 'Aguardando primeiro scan...'} • atualiza a cada 10 min</span>
  </div>

  ${store.crossArbOpportunities.length === 0
    ? store.lastCrossArbScanAt
      ? `<div class="empty-state">⚪ Ciclo concluído — nenhum par Kalshi × Polymarket com divergência ≥ 5% encontrado.<br><span class="muted" style="font-size:0.8rem">Verifique o diagnóstico no Telegram para detalhes. Próximo scan em ~10 min.</span></div>`
      : `<div class="empty-state">⏳ Aguardando primeiro ciclo (inicia 2 min após o bot subir)...<br><span class="muted" style="font-size:0.8rem">Compara preços Kalshi vs Polymarket. Divergência ≥ 5% dispara alerta.</span></div>`
    : `<table>
    <thead><tr>
      <th>Kalshi (referência)</th>
      <th>Polymarket (pergunta)</th>
      <th>Kalshi %</th>
      <th>Poly %</th>
      <th>Divergência</th>
      <th>Recomendação</th>
      <th>Similaridade</th>
      <th>Links</th>
    </tr></thead>
    <tbody>
      ${store.crossArbOpportunities.map(opp => {
        const absDiv = Math.abs(opp.divergence * 100);
        const divColor = absDiv >= 15 ? '#4ade80' : absDiv >= 10 ? '#f59e0b' : '#94a3b8';
        const recColor = opp.recommendation === 'BUY_YES' ? '#4ade80' : '#f87171';
        return `<tr>
          <td style="font-size:0.78rem;max-width:200px;color:#94a3b8" title="${opp.kalshiTitle}">${opp.kalshiTitle.slice(0, 55)}${opp.kalshiTitle.length > 55 ? '…' : ''}</td>
          <td style="font-size:0.8rem;max-width:260px" title="${opp.polyQuestion}">${opp.polyQuestion.slice(0, 65)}${opp.polyQuestion.length > 65 ? '…' : ''}</td>
          <td class="${opp.kalshiProb >= 0.5 ? 'up' : 'down'}">${(opp.kalshiProb * 100).toFixed(1)}%</td>
          <td class="${opp.polyProb >= 0.5 ? 'up' : 'down'}">${(opp.polyProb * 100).toFixed(1)}%</td>
          <td style="font-weight:700;color:${divColor}">${opp.divergence > 0 ? '+' : ''}${(opp.divergence * 100).toFixed(1)}%</td>
          <td style="font-weight:700;color:${recColor}">${opp.recommendation === 'BUY_YES' ? '✅ YES' : '❌ NO'}</td>
          <td class="muted">${(opp.matchScore * 100).toFixed(0)}%</td>
          <td style="font-size:0.78rem">
            <a href="https://polymarket.com/event/${opp.polyEventSlug}" target="_blank" style="color:#6366f1">Poly</a>
            &nbsp;·&nbsp;
            <a href="https://kalshi.com/markets/${opp.kalshiTicker}" target="_blank" style="color:#8b5cf6">Kalshi</a>
          </td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>`}

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
