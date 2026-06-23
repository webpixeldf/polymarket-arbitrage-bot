'use strict';
// Replica o SELL bem-sucedido do trade histórico para identificar por que SELL funciona mas BUY não
require('dotenv').config({ override: true });
if (process.env.WEBSHARE_PROXY_URL) {
  process.env.GLOBAL_AGENT_HTTPS_PROXY = process.env.WEBSHARE_PROXY_URL;
  require('global-agent/bootstrap');
}
const { ethers } = require('ethers');
const axios = require('axios');

async function main() {
  const v5 = await import('clob-v5');
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY);
  const proxy  = process.env.PROXY_WALLET_ADDRESS;
  const creds  = { key: process.env.API_KEY, secret: process.env.API_SECRET, passphrase: process.env.API_PASSPHRASE };
  const CLOB   = 'https://clob.polymarket.com';

  // Token do trade histórico bem-sucedido
  const HIST_TOKEN = '46788745865873849751895851580006231458025441200398102606849707486161173481896';

  // Verifica estado atual do mercado
  const [feeR, nrR, book] = await Promise.all([
    axios.get(`${CLOB}/fee-rate`, { params: { token_id: HIST_TOKEN }, timeout: 5000 }).catch(e => ({ data: { base_fee: 0 } })),
    axios.get(`${CLOB}/neg-risk`, { params: { token_id: HIST_TOKEN }, timeout: 5000 }).catch(e => ({ data: { neg_risk: false } })),
    axios.get(`${CLOB}/book`,     { params: { token_id: HIST_TOKEN }, timeout: 5000 }).catch(e => ({ data: {} })),
  ]);
  console.log('fee_rate:', feeR.data?.base_fee, '| negRisk:', nrR.data?.neg_risk);
  const bids = book.data?.bids?.slice(0,3) || [];
  const asks = book.data?.asks?.slice(0,3) || [];
  console.log('Bids (top 3):', JSON.stringify(bids));
  console.log('Asks (top 3):', JSON.stringify(asks));

  const client = new v5.ClobClient(CLOB, 137, wallet, creds, 1, proxy);

  // Testa com vários feeRateBps para BUY (para identificar qual valor aceita)
  const feeTests = [0, 100, 500, 1000];
  for (const fee of feeTests) {
    try {
      const order = await client.createOrder(
        { tokenID: HIST_TOKEN, price: 0.50, size: 1.0, side: v5.Side.BUY, feeRateBps: fee },
        { negRisk: nrR.data?.neg_risk === true }
      );
      const resp = await client.postOrder(order, v5.OrderType.GTC, false);
      console.log(`\nBUY GTC fee=${fee}: ${resp?.error || JSON.stringify(resp)?.slice(0,100)}`);
      if (!resp?.error && resp?.orderID) {
        await client.cancelOrder({ orderID: resp.orderID }).catch(() => {});
        console.log('✅ SUCESSO! feeRateBps correto:', fee);
      }
    } catch(e) { console.log(`BUY GTC fee=${fee}: ERRO ${e.message?.slice(0,60)}`); }
  }

  // Testa SELL GTC (como o bot fez com sucesso)
  console.log('\n--- SELL GTC (como o bot fez) ---');
  for (const fee of [0, 1000]) {
    try {
      const order = await client.createOrder(
        { tokenID: HIST_TOKEN, price: 0.999, size: 1.0, side: v5.Side.SELL, feeRateBps: fee },
        { negRisk: nrR.data?.neg_risk === true }
      );
      const resp = await client.postOrder(order, v5.OrderType.GTC, false);
      console.log(`SELL GTC fee=${fee}: ${resp?.error || JSON.stringify(resp)?.slice(0,100)}`);
      if (!resp?.error && resp?.orderID) {
        await client.cancelOrder({ orderID: resp.orderID }).catch(() => {});
        console.log('✅ SELL aceito com fee:', fee);
      }
    } catch(e) { console.log(`SELL GTC fee=${fee}: ERRO ${e.message?.slice(0,60)}`); }
  }
}

main().catch(console.error);
