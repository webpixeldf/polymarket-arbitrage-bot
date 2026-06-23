'use strict';
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
  const EOA   = wallet.address;
  const proxy = process.env.PROXY_WALLET_ADDRESS;
  const creds = { key: process.env.API_KEY, secret: process.env.API_SECRET, passphrase: process.env.API_PASSPHRASE };
  const CLOB  = 'https://clob.polymarket.com';

  console.log('EOA:  ', EOA);
  console.log('Proxy:', proxy);

  const client = new v5.ClobClient(CLOB, 137, wallet, creds, 1, proxy);

  // 1) Chaves API existentes
  console.log('\n=== 1) Chaves API cadastradas ===');
  try {
    const keys = await client.getApiKeys();
    console.log('getApiKeys:', JSON.stringify(keys));
  } catch(e) { console.log('Erro:', e.message?.slice(0,100)); }

  // 2) Tenta createApiKey (POST — cria nova chave)
  console.log('\n=== 2) createApiKey (POST /auth/api-key) ===');
  try {
    const newKey = await client.createApiKey();
    console.log('Nova chave:', JSON.stringify(newKey));
    // Testa ordem com essa nova chave
    const c2 = new v5.ClobClient(CLOB, 137, wallet, newKey, 1, proxy);
    const order = await c2.createOrder(
      { tokenID: '30919109558246209971545892228598482722881502507049010402392877610451001659386', price: 0.05, size: 1.0, side: v5.Side.BUY },
      { negRisk: true }
    );
    const resp = await c2.postOrder(order, v5.OrderType.FOK, false);
    console.log('Ordem com nova chave:', JSON.stringify(resp));
  } catch(e) { console.log('Erro createApiKey:', e.message?.slice(0,100)); }

  // 3) Verifica endereço correto do Exchange no CLOB
  console.log('\n=== 3) Endereço Exchange via CLOB API ===');
  try {
    const r = await axios.get(`${CLOB}/neg-risk`, { params: { token_id: '30919109558246209971545892228598482722881502507049010402392877610451001659386' }, timeout: 8000 });
    console.log('neg-risk response:', JSON.stringify(r.data));
  } catch(e) { console.log('Erro:', e.message); }

  // 4) Verifica histórico de trades (se a conta já operou antes)
  console.log('\n=== 4) Histórico de trades ===');
  try {
    const trades = await client.getTrades({ maker_address: proxy });
    console.log('Trades:', JSON.stringify(trades)?.slice(0, 300) || '[]');
  } catch(e) { console.log('Erro getTrades:', e.message?.slice(0,100)); }

  // 5) Testa endpoint /accounts
  console.log('\n=== 5) GET /accounts ===');
  try {
    const r = await axios.get(`${CLOB}/accounts`, { params: { address: proxy }, timeout: 8000 });
    console.log('/accounts:', JSON.stringify(r.data)?.slice(0,300));
  } catch(e) { console.log('Erro /accounts:', e.response?.status, e.message?.slice(0,80)); }
}

main().catch(console.error);
