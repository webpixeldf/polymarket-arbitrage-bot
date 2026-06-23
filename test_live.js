// Testa POST /order contra mercado weather VIVO (endDate futuro)
const axios = require('axios');
require('dotenv').config({ override: true });
const { ClobClient, Side } = require('@polymarket/clob-client');
const { ethers } = require('ethers');
const { createHmac } = require('crypto');

async function test() {
  const r = await axios.get('https://gamma-api.polymarket.com/markets', {
    params: { active: true, limit: 300, order: 'endDate', ascending: false },
    timeout: 15000,
  });
  const now = Date.now();
  const m = r.data.find(x =>
    x.question &&
    x.question.toLowerCase().includes('temperature') &&
    x.endDate && new Date(x.endDate).getTime() > now
  );

  if (!m) { console.log('Nenhum mercado weather aberto'); return; }
  const ids = JSON.parse(m.clobTokenIds);
  const tokenId = ids[0];
  console.log('Mercado:', m.question.slice(0, 70));
  console.log('endDate:', m.endDate);
  console.log('tokenId:', tokenId);

  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY);
  const creds = {
    key: process.env.API_KEY,
    secret: process.env.API_SECRET,
    passphrase: process.env.API_PASSPHRASE,
  };
  const client = new ClobClient('https://clob.polymarket.com', 137, wallet, creds, 1, process.env.PROXY_WALLET_ADDRESS);

  const [feeR, nrR] = await Promise.all([
    axios.get('https://clob.polymarket.com/fee-rate', { params: { token_id: tokenId }, timeout: 5000 }),
    axios.get('https://clob.polymarket.com/neg-risk', { params: { token_id: tokenId }, timeout: 5000 }),
  ]);
  const feeRateBps = feeR.data.base_fee ?? 0;
  const negRisk = nrR.data.neg_risk === true;
  console.log('fee:', feeRateBps, '| negRisk:', negRisk);

  const order = await client.createOrder(
    { tokenID: tokenId, price: 0.05, size: 1.0, side: Side.BUY, feeRateBps },
    { negRisk }
  );
  console.log('Ordem criada: maker=' + order.maker.slice(0,10) + '... fee=' + order.feeRateBps + ' sigType=' + order.signatureType);

  const sideStr = order.side === 0 ? 'BUY' : 'SELL';
  const payload = {
    deferExec: false,
    order: {
      salt:          parseInt(order.salt, 10),
      maker:         order.maker,
      signer:        order.signer,
      taker:         order.taker,
      tokenId:       order.tokenId,
      makerAmount:   order.makerAmount,
      takerAmount:   order.takerAmount,
      side:          sideStr,
      expiration:    order.expiration,
      nonce:         order.nonce,
      feeRateBps:    order.feeRateBps,
      signatureType: order.signatureType,
      signature:     order.signature,
    },
    owner:     creds.key,
    orderType: 'FOK',
  };

  const ts   = Math.floor(Date.now() / 1000);
  const body = JSON.stringify(payload);
  const normalized = creds.secret.replace(/-/g, '+').replace(/_/g, '/');
  const sig = createHmac('sha256', Buffer.from(normalized, 'base64'))
    .update(ts + 'POST' + '/order' + body)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  try {
    const resp = await axios.post('https://clob.polymarket.com/order', payload, {
      headers: {
        POLY_ADDRESS:    order.signer,
        POLY_SIGNATURE:  sig,
        POLY_TIMESTAMP:  String(ts),
        POLY_API_KEY:    creds.key,
        POLY_PASSPHRASE: creds.passphrase,
        'Content-Type':  'application/json',
        'User-Agent':    '@polymarket/clob-client',
        'Accept':        '*/*',
        'Connection':    'keep-alive',
      },
      timeout: 10000,
    });
    console.log('\n✅ SUCESSO:', JSON.stringify(resp.data));
  } catch (e) {
    console.log('\n❌ ERRO HTTP', e.response?.status, JSON.stringify(e.response?.data));
  }
}

test().catch(console.error);
