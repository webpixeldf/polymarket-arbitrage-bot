// Testa POST /order contra mercado vivo usando bridge v5 nativo
const axios = require('axios');
require('dotenv').config({ override: true });
const { ethers } = require('ethers');
const { postOrderNativeV5 } = require('./src/v5bridge');

async function test() {
  // Busca mercado de alto volume — qualquer categoria, só precisa estar aberto
  const r = await axios.get('https://gamma-api.polymarket.com/markets', {
    params: { active: true, limit: 50, order: 'volume', ascending: false },
    timeout: 15000,
  });
  const now = Date.now();
  const m = r.data.find(x =>
    x.endDate && new Date(x.endDate).getTime() > now &&
    x.clobTokenIds && x.clobTokenIds !== '[]'
  );

  if (!m) { console.log('Nenhum mercado aberto'); return; }
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

  const [feeR, nrR] = await Promise.all([
    axios.get('https://clob.polymarket.com/fee-rate', { params: { token_id: tokenId }, timeout: 5000 }),
    axios.get('https://clob.polymarket.com/neg-risk', { params: { token_id: tokenId }, timeout: 5000 }),
  ]);
  const feeRateBps = feeR.data.base_fee ?? 0;
  const negRisk = nrR.data.neg_risk === true;
  console.log('fee:', feeRateBps, '| negRisk:', negRisk);

  // Testa 3 configurações de signatureType para descobrir qual funciona
  const configs = [
    { label: 'sigType=1 POLY_PROXY  (proxy wallet como maker)', signatureType: 1, proxyWallet: process.env.PROXY_WALLET_ADDRESS },
    { label: 'sigType=0 EOA         (EOA como maker, sem proxy)', signatureType: 0, proxyWallet: undefined },
    { label: 'sigType=2 GNOSIS_SAFE (proxy wallet como maker)', signatureType: 2, proxyWallet: process.env.PROXY_WALLET_ADDRESS },
  ];

  for (const cfg of configs) {
    console.log('\n--- Testando:', cfg.label, '---');
    try {
      const resp = await postOrderNativeV5({
        clobUrl: 'https://clob.polymarket.com',
        chainId: 137,
        wallet,
        creds,
        signatureType: cfg.signatureType,
        proxyWallet: cfg.proxyWallet,
        tokenID: tokenId,
        price: 0.05,
        size: 1.0,
        buyOrSell: 'BUY',
        feeRateBps,
        negRisk,
        orderType: 'FOK',
      });
      console.log('RESP:', JSON.stringify(resp));
    } catch (e) {
      console.log('ERRO:', e.message);
    }
  }
}

test().catch(console.error);
