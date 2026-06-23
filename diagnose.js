// Diagnóstico completo: L2 auth + balance + order test com token vivo
const { ClobClient, OrderType, Side } = require('@polymarket/clob-client');
const { buildPolyHmacSignature: buildPolyHmacV4 } = require('@polymarket/clob-client/dist/signing/hmac');
const { createHmac } = require('crypto');
const { ethers } = require('ethers');
const axios = require('axios');
require('dotenv').config({ override: true });

// V5 HMAC: normaliza base64url antes de decodificar
function buildHmacV5(secret, ts, method, path, body) {
  const normalized = secret.replace(/-/g, '+').replace(/_/g, '/');
  const key = Buffer.from(normalized, 'base64');
  const message = `${ts}${method}${path}${body || ''}`;
  const sig = createHmac('sha256', key).update(message).digest('base64');
  return sig.replace(/\+/g, '-').replace(/\//g, '_');
}

const CLOB_URL = 'https://clob.polymarket.com';
const GAMMA_URL = 'https://gamma-api.polymarket.com';

async function main() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) { console.error('PRIVATE_KEY não encontrado'); process.exit(1); }

  const wallet = new ethers.Wallet(pk);
  const EOA = wallet.address;
  const proxy = process.env.PROXY_WALLET_ADDRESS;

  console.log('\n=== ADDRESSES ===');
  console.log('EOA:  ', EOA);
  console.log('Proxy:', proxy);
  console.log('SigType:', process.env.SIGNATURE_TYPE ?? '1');

  const creds = {
    key: process.env.API_KEY,
    secret: process.env.API_SECRET,
    passphrase: process.env.API_PASSPHRASE,
  };
  console.log('API Key:', creds.key?.slice(0, 12) + '...');

  const sigType = parseInt(process.env.SIGNATURE_TYPE ?? '1');
  const client = new ClobClient(CLOB_URL, 137, wallet, creds, sigType, proxy);

  // 1) Teste L2 auth
  console.log('\n=== 1) TESTE L2 AUTH (GET /orders) ===');
  try {
    const orders = await client.getOpenOrders();
    console.log('✅ L2 auth OK — open orders:', JSON.stringify(orders).slice(0, 200));
  } catch (e) {
    console.error('❌ L2 auth FALHOU:', e.message);
  }

  // 2) Balance
  console.log('\n=== 2) BALANCE/ALLOWANCE ===');
  try {
    const bal = await client.getBalanceAllowance({ asset_type: 'USDC' });
    console.log('USDC:', JSON.stringify(bal));
  } catch (e) {
    console.error('Balance error:', e.message);
  }

  // diagnóstico do secret
  console.log('\n=== DIAGNÓSTICO HMAC ===');
  const secretHasUrlChars = /[-_]/.test(creds.secret);
  console.log(`Secret tem base64url chars (-/_): ${secretHasUrlChars ? 'SIM ⚠️  (v4 gera HMAC errado!)' : 'NÃO ✅ (v4 e v5 idênticos)'}`);
  const ts0 = Math.floor(Date.now() / 1000);
  const hmacV4 = buildPolyHmacV4(creds.secret, ts0, 'GET', '/data/orders', '');
  const hmacV5 = buildHmacV5(creds.secret, ts0, 'GET', '/data/orders', '');
  console.log(`HMAC v4: ${hmacV4.slice(0, 20)}...`);
  console.log(`HMAC v5: ${hmacV5.slice(0, 20)}...`);
  console.log(`HMAC igual? ${hmacV4 === hmacV5 ? 'SIM ✅' : 'NÃO ❌ — v5 necessário!'}`);

  // 3) Busca token ID de mercado weather NÃO expirado
  console.log('\n=== 3) BUSCANDO MERCADO WEATHER ABERTO ===');
  let TOKEN_ID = null;
  let negRisk = false;
  let feeRateBps = 0;
  let foundMarket = null;
  try {
    const now = Date.now();
    let offset = 0;
    const limit = 100;
    while (offset < 600 && !TOKEN_ID) {
      const resp = await axios.get(`${GAMMA_URL}/markets`, {
        params: { active: true, limit, offset, order: 'endDate', ascending: true },
        timeout: 15000,
      });
      const markets = resp.data;
      if (!markets.length) break;
      for (const m of markets) {
        if (!m.question) continue;
        const q = m.question.toLowerCase();
        if (!q.includes('temperature') && !q.includes('celsius') && !q.includes('degrees')) continue;
        if (!m.endDate) continue;
        const msToEnd = new Date(m.endDate).getTime() - now;
        if (msToEnd < 0) continue;  // expirado
        const ids = JSON.parse(m.clobTokenIds || '[]');
        if (!ids.length) continue;
        TOKEN_ID = ids[0];
        foundMarket = m;
        console.log(`✅ Mercado aberto: "${m.question.slice(0, 70)}"`);
        console.log(`   endDate: ${m.endDate} (${(msToEnd/3_600_000).toFixed(1)}h restantes)`);
        console.log(`   tokenId: ${TOKEN_ID}`);
        break;
      }
      offset += limit;
    }
    if (!TOKEN_ID) {
      console.log('⚠️  Nenhum mercado weather aberto encontrado — usando token hardcoded para diagnóstico');
      TOKEN_ID = '56441613474608958357488383796816307365995276962960033087501461366776172243406';
    }
  } catch (e) {
    console.error('Gamma API error:', e.message);
    TOKEN_ID = '56441613474608958357488383796816307365995276962960033087501461366776172243406';
  }

  // 4) Busca fee-rate e neg-risk do token
  console.log('\n=== 4) FEE-RATE + NEG-RISK ===');
  try {
    const [feeResp, nrResp] = await Promise.all([
      axios.get(`${CLOB_URL}/fee-rate`, { params: { token_id: TOKEN_ID }, timeout: 5000 }),
      axios.get(`${CLOB_URL}/neg-risk`, { params: { token_id: TOKEN_ID }, timeout: 5000 }),
    ]);
    feeRateBps = feeResp.data?.base_fee ?? 0;
    negRisk = nrResp.data?.neg_risk === true;
    console.log(`fee_rate base_fee=${feeRateBps}  neg_risk=${negRisk}`);
  } catch (e) {
    console.error('fee/negRisk error:', e.message);
  }

  // 5) Orderbook do token
  console.log('\n=== 5) ORDERBOOK ===');
  let bestAsk = 0.5;
  try {
    const ob = await client.getOrderBook(TOKEN_ID);
    const asks = ob.asks || [];
    if (asks.length) {
      bestAsk = parseFloat(asks[asks.length - 1].price ?? asks[0].price);
      console.log(`bestAsk=${bestAsk}  spread asks: ${asks.slice(0, 3).map(a => a.price).join(', ')}`);
    } else {
      console.log('Sem asks no orderbook');
    }
  } catch (e) {
    console.error('Orderbook error:', e.message);
  }

  // 6) Cria ordem (SEM enviar)
  console.log('\n=== 6) CRIA ORDEM (createOrder) ===');
  let order = null;
  try {
    const limitPrice = Math.min(bestAsk + 0.03, 0.99);
    order = await client.createOrder({
      tokenID: TOKEN_ID,
      price: parseFloat(limitPrice.toFixed(4)),
      size: 1.0,
      side: Side.BUY,
      feeRateBps,
    }, { negRisk });
    console.log(`✅ Ordem criada:`);
    console.log(`   maker=${order.maker}  signer=${order.signer}`);
    console.log(`   sigType=${order.signatureType}  fee=${order.feeRateBps}  negRisk=${negRisk}`);
    console.log(`   makerAmt=${order.makerAmount}  takerAmt=${order.takerAmount}  side=${order.side}`);
    console.log(`   sig=${order.signature.slice(0, 20)}...`);
  } catch (e) {
    console.error('❌ createOrder FALHOU:', e.message);
    return;
  }

  // 7) Envia ordem com formato v5 (deferExec:false + User-Agent + corretos L2 headers)
  console.log('\n=== 7) POST /order (v5 format: deferExec:false + User-Agent) ===');
  try {
    const sideStr = (order.side === 0) ? 'BUY' : 'SELL';
    const payload = {
      deferExec: false,
      order: {
        salt: parseInt(order.salt, 10),
        maker: order.maker,
        signer: order.signer,
        taker: order.taker,
        tokenId: order.tokenId,
        makerAmount: order.makerAmount,
        takerAmount: order.takerAmount,
        side: sideStr,
        expiration: order.expiration,
        nonce: order.nonce,
        feeRateBps: order.feeRateBps,
        signatureType: order.signatureType,
        signature: order.signature,
      },
      owner: creds.key,
      orderType: 'FOK',
    };

    const ts   = Math.floor(Date.now() / 1000);
    const body = JSON.stringify(payload);
    // Usa HMAC v5 (normaliza base64url) para corrigir bug do v4 com secrets que contêm - e _
    const sig  = buildHmacV5(creds.secret, ts, 'POST', '/order', body);
    const sigV4 = buildPolyHmacV4(creds.secret, ts, 'POST', '/order', body);
    console.log(`HMAC v5: ${sig.slice(0, 20)}... | v4: ${sigV4.slice(0, 20)}... | igual: ${sig === sigV4}`);

    console.log('Payload enviado:', JSON.stringify({...payload, order: {...payload.order, signature: payload.order.signature.slice(0,20)+'...'}}, null, 2));

    const resp = await axios.post(`${CLOB_URL}/order`, payload, {
      headers: {
        POLY_ADDRESS:    order.signer,
        POLY_SIGNATURE:  sig,
        POLY_TIMESTAMP:  `${ts}`,
        POLY_API_KEY:    creds.key,
        POLY_PASSPHRASE: creds.passphrase,
        'Content-Type':  'application/json',
        'User-Agent':    '@polymarket/clob-client',
        'Accept':        '*/*',
        'Connection':    'keep-alive',
      },
      timeout: 10_000,
    });
    console.log('✅ POST resp:', JSON.stringify(resp.data));
  } catch (e) {
    if (e.response) {
      console.error('❌ HTTP', e.response.status, JSON.stringify(e.response.data));
      console.error('   (se 400 "invalid order version" → order format problem)');
      console.error('   (se 400 "not enough balance" → funcionou! saldo insuficiente)');
      console.error('   (se 400 "market closed" → mercado expirou)');
    } else {
      console.error('❌ Erro de rede:', e.message);
    }
  }

  // 8) Teste com v4 client.postOrder puro (SEM deferExec) — para comparação
  console.log('\n=== 8) POST /order via v4 client.postOrder (SEM deferExec) ===');
  try {
    const order2 = await client.createOrder({
      tokenID: TOKEN_ID,
      price: parseFloat(Math.min(bestAsk + 0.03, 0.99).toFixed(4)),
      size: 1.0,
      side: Side.BUY,
      feeRateBps,
    }, { negRisk });
    const resp2 = await client.postOrder(order2, OrderType.FOK);
    console.log('✅ v4 postOrder resp:', JSON.stringify(resp2));
  } catch (e) {
    console.error('❌ v4 postOrder:', e.message, JSON.stringify(e.response?.data || ''));
  }
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
