import { scanCryptoMarkets } from './cryptoScanner';
import { analyzeMarket } from './aiAnalyzer';
import { notify } from '../notifier';
import { store } from '../store';
import { createClobClient, getBestAsk, buyShares } from '../api';
import fs from 'fs';
import path from 'path';

const SCAN_INTERVAL_MS = 30 * 60 * 1000; // 30 minutos
const MIN_EDGE = parseFloat(process.env.MIN_EDGE ?? '10');
const MIN_CONFIDENCE = parseFloat(process.env.MIN_CONFIDENCE ?? '65');
const BET_USDC = parseFloat(process.env.MAX_BET_USDC ?? '10');
const ENTERED_FILE = path.join(process.cwd(), 'data', 'phase2_entered.json');

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Persiste mercados já apostados em disco — sobrevive a reinicializações
function loadEntered(): Set<string> {
  try {
    fs.mkdirSync(path.dirname(ENTERED_FILE), { recursive: true });
    if (fs.existsSync(ENTERED_FILE)) {
      const ids: string[] = JSON.parse(fs.readFileSync(ENTERED_FILE, 'utf8'));
      return new Set(ids);
    }
  } catch {}
  return new Set();
}

function saveEntered(set: Set<string>): void {
  try {
    fs.writeFileSync(ENTERED_FILE, JSON.stringify([...set]), 'utf8');
  } catch {}
}

const alertedConditions = loadEntered();

async function runCycle(client: ReturnType<typeof createClobClient>, simulate: boolean): Promise<void> {
  console.error('[Phase2] Escaneando mercados cripto com baixo volume...');

  const markets = await scanCryptoMarkets();
  console.error(`[Phase2] ${markets.length} mercados cripto encontrados`);

  if (markets.length === 0) return;

  let found = 0;

  for (const market of markets) {
    if (alertedConditions.has(market.conditionId)) continue;

    await sleep(1500); // rate limit DeepSeek

    const analysis = await analyzeMarket(
      market.question,
      market.probability,
      market.liquidity,
      market.daysToEnd,
    );
    if (!analysis) continue;

    const absEdge = Math.abs(analysis.edge);
    const isValueBet = absEdge >= MIN_EDGE && analysis.confidence >= MIN_CONFIDENCE;

    console.error(
      `[Phase2] "${market.question.slice(0, 50)}" | Mercado: ${market.probability.toFixed(1)}% | IA: ${analysis.probability.toFixed(1)}% | Edge: ${analysis.edge > 0 ? '+' : ''}${analysis.edge.toFixed(1)}% | Conf: ${analysis.confidence.toFixed(0)}%`
    );

    if (!isValueBet) continue;

    found++;
    alertedConditions.add(market.conditionId);
    saveEntered(alertedConditions);

    // Determinar qual token comprar (YES = index 0, NO = index 1)
    const buyYes = analysis.edge > 0;
    const tokenId = buyYes ? market.clobTokenIds[0] : market.clobTokenIds[1];
    const simLabel = simulate ? '[SIMULAÇÃO] ' : '';
    const rec = buyYes ? '✅ COMPRAR SIM (YES)' : '❌ COMPRAR NÃO (NO)';

    // Auto-executar a ordem
    let orderResult = '';
    if (tokenId) {
      const price = await getBestAsk(tokenId);
      if (price !== null && price > 0) {
        const shares = Math.floor((BET_USDC / price) * 10) / 10; // 1 casa decimal
        if (shares > 0) {
          const orderId = await buyShares(client, tokenId, price, shares, simulate);
          if (orderId) {
            const cost = (shares * price).toFixed(2);
            orderResult = simulate
              ? `\n🤖 [SIM] Ordem simulada: ${shares} ${buyYes ? 'YES' : 'NO'} @ ${(price * 100).toFixed(0)}¢ ($${cost})`
              : `\n✅ Ordem executada! ID: ${orderId} — ${shares} ${buyYes ? 'YES' : 'NO'} @ ${(price * 100).toFixed(0)}¢ ($${cost})`;
            console.error(`[Phase2] Ordem ${simulate ? 'SIMULADA' : 'EXECUTADA'}: ${shares} ${buyYes ? 'YES' : 'NO'} @ ${price.toFixed(4)} | $${cost} | orderId: ${orderId}`);
          } else {
            orderResult = '\n⚠️ Ordem falhou — execute manualmente.';
          }
        }
      } else {
        orderResult = '\n⚠️ Sem liquidez no CLOB — execute manualmente.';
      }
    } else {
      orderResult = '\n⚠️ Token ID não disponível — execute manualmente.';
    }

    // Store for dashboard
    store.valueBets.unshift({
      conditionId: market.conditionId,
      question: market.question,
      questionPT: analysis.questionPT,
      slug: market.slug,
      eventSlug: market.eventSlug,
      marketProb: market.probability,
      aiProb: analysis.probability,
      edge: analysis.edge,
      confidence: analysis.confidence,
      reasoning: analysis.reasoning,
      liquidity: market.liquidity,
      daysToEnd: market.daysToEnd,
      recommendation: buyYes ? 'BUY_YES' : 'BUY_NO',
      simulate,
      timestamp: new Date().toISOString(),
    });
    if (store.valueBets.length > 30) store.valueBets.pop();

    await notify(
      `${simLabel}🎯 VALUE BET — Edge ${analysis.edge > 0 ? '+' : ''}${analysis.edge.toFixed(1)}%`,
      [
        `🎯 MERCADO CRIPTO COM PREÇO ERRADO`,
        ``,
        `📌 ${analysis.questionPT}`,
        ``,
        `💧 Liquidez: $${market.liquidity.toFixed(0)}`,
        `📅 Encerra em: ${market.daysToEnd.toFixed(0)} dias`,
        ``,
        `📊 Mercado diz: ${market.probability.toFixed(1)}%`,
        `🤖 IA estima: ${analysis.probability.toFixed(1)}%`,
        `📈 Edge: ${analysis.edge > 0 ? '+' : ''}${analysis.edge.toFixed(1)}%`,
        `🎯 Confiança: ${analysis.confidence.toFixed(0)}%`,
        ``,
        `${rec}`,
        orderResult.trim(),
        ``,
        `💡 ${analysis.reasoning}`,
        ``,
        `🔗 polymarket.com/event/${market.eventSlug}`,
      ].join('\n')
    );

    if (found >= 3) break; // max 3 por ciclo
  }

  store.lastScanAt = new Date().toISOString();
  console.error(`[Phase2] Ciclo concluído — ${found} value bets. Próximo em 30 min.`);
}

export async function startPhase2(simulate: boolean): Promise<void> {
  if (!process.env.DEEPSEEK_API_KEY) {
    console.error('[Phase2] DEEPSEEK_API_KEY não configurado — Phase 2 desativada.');
    return;
  }

  const client = createClobClient();
  console.error('[Phase2] Iniciando — mercados CRIPTO com baixo volume + auto-execução...');
  await sleep(60_000); // aguarda 1 min antes do primeiro scan

  while (true) {
    try {
      await runCycle(client, simulate);
    } catch (err) {
      console.error('[Phase2] Erro no ciclo:', (err as Error).message);
    }
    await sleep(SCAN_INTERVAL_MS);
  }
}
