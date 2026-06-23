// Diagnóstico completo: L2 auth + on-chain balance + order test
const { ClobClient, OrderType, Side } = require('@polymarket/clob-client');
const { ethers } = require('ethers');
require('dotenv').config({ override: true });

const CLOB_URL = 'https://clob.polymarket.com';

async function main() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) { console.error('PRIVATE_KEY não encontrado'); process.exit(1); }

  const wallet = new ethers.Wallet(pk);
  const EOA = wallet.address;
  const proxy = process.env.PROXY_WALLET_ADDRESS;

  console.log('\n=== ADDRESSES ===');
  console.log('EOA:  ', EOA);
  console.log('Proxy:', proxy);
  console.log('SigType:', process.env.SIGNATURE_TYPE);

  const creds = {
    key: process.env.API_KEY,
    secret: process.env.API_SECRET,
    passphrase: process.env.API_PASSPHRASE,
  };
  console.log('\n=== CREDENCIAIS ===');
  console.log('Key:', creds.key);
  console.log('Secret:', creds.secret?.slice(0, 10) + '...');

  const sigType = parseInt(process.env.SIGNATURE_TYPE ?? '1');
  const client = new ClobClient(CLOB_URL, 137, wallet, creds, sigType, proxy);

  // 1) Teste L2 auth com GET /orders
  console.log('\n=== TESTE L2 AUTH (GET /orders) ===');
  try {
    const orders = await client.getOpenOrders();
    console.log('✅ L2 auth OK — open orders:', JSON.stringify(orders).slice(0, 200));
  } catch (e) {
    console.error('❌ L2 auth FALHOU:', e.message);
  }

  // 2) Balance/allowance
  console.log('\n=== BALANCE/ALLOWANCE ===');
  try {
    const bal = await client.getBalanceAllowance({ asset_type: 'USDC' });
    console.log('USDC:', JSON.stringify(bal));
  } catch (e) {
    console.error('Balance error:', e.message);
  }

  // 3) Testa ordem com feeRateBps correto (1000 = taxa do mercado)
  const TOKEN_ID = '56441613474608958357488383796816307365995276962960033087501461366776172243406';
  console.log('\n=== TESTE ORDER (YES@15¢ negRisk feeRateBps=1000) ===');
  try {
    // busca fee real
    const feeResp = await axios.get(`https://clob.polymarket.com/fee-rate`, {params:{token_id:TOKEN_ID}});
    console.log('fee-rate:', JSON.stringify(feeResp.data));
    const feeRateBps = feeResp.data?.base_fee ?? 0;

    const order = await client.createOrder({
      tokenID: TOKEN_ID,
      price: 0.20,
      size: 25.0,    // $5 em shares a 20¢
      side: Side.BUY,
      feeRateBps,
    }, { negRisk: true });
    console.log('Ordem criada:', JSON.stringify({
      maker: order.maker,
      signer: order.signer,
      signatureType: order.signatureType,
      makerAmount: order.makerAmount,
      takerAmount: order.takerAmount,
      sig: order.signature?.slice(0, 20),
    }));
    const resp = await client.postOrder(order, OrderType.FOK);
    console.log('POST resp:', JSON.stringify(resp));
  } catch (e) {
    console.error('Order test erro:', e.message);
  }

  // 4) Testa com payload manual incluindo deferExec:false (formato v5)
  console.log('\n=== TESTE payload manual com deferExec:false (v5 format) ===');
  try {
    const axios = require('axios');
    const { buildPolyHmacSignature } = require('@polymarket/clob-client/dist/signing/hmac');
    const { buildClobEip712Signature } = require('@polymarket/clob-client/dist/signing/eip712');

    // Cria ordem assinada
    const clientV4 = new ClobClient(CLOB_URL, 137, wallet, creds, 1, proxy);
    const order = await clientV4.createOrder({
      tokenID: TOKEN_ID,
      price: 0.15,
      size: 1.0,
      side: Side.BUY,
    }, { negRisk: true });

    // Monta payload no formato v5 (com deferExec) — usando side string e amounts corretos
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
        side: 'BUY',
        expiration: order.expiration,
        nonce: order.nonce,
        feeRateBps: order.feeRateBps,
        signatureType: order.signatureType,
        signature: order.signature,
      },
      owner: creds.key,
      orderType: 'FOK',
    };

    // Gera L2 headers manualmente
    const ts = Math.floor(Date.now() / 1000);
    const body = JSON.stringify(payload);
    const sig = buildPolyHmacSignature(creds.secret, ts, 'POST', '/order', body);
    const headers = {
      'POLY_ADDRESS': wallet.address,
      'POLY_SIGNATURE': sig,
      'POLY_TIMESTAMP': `${ts}`,
      'POLY_API_KEY': creds.key,
      'POLY_PASSPHRASE': creds.passphrase,
      'Content-Type': 'application/json',
      'User-Agent': '@polymarket/clob-client',
      'Accept': '*/*',
    };

    console.log('Enviando payload v5 com deferExec:false...');
    const resp = await axios.post(`${CLOB_URL}/order`, payload, { headers });
    console.log('✅ Resp:', JSON.stringify(resp.data));
  } catch (e) {
    if (e.response) {
      console.error('❌ HTTP', e.response.status, JSON.stringify(e.response.data));
    } else {
      console.error('❌ Erro:', e.message);
    }
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
