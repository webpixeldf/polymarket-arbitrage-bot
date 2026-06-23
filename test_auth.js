'use strict';
require('dotenv').config({ override: true });
// Proxy global via WEBSHARE
if (process.env.WEBSHARE_PROXY_URL) {
  process.env.GLOBAL_AGENT_HTTPS_PROXY = process.env.WEBSHARE_PROXY_URL;
  require('global-agent/bootstrap');
}
const { ethers } = require('ethers');

async function main() {
  const v5 = await import('clob-v5');
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY);
  const EOA = wallet.address;
  const proxy = process.env.PROXY_WALLET_ADDRESS;
  const creds = {
    key: process.env.API_KEY,
    secret: process.env.API_SECRET,
    passphrase: process.env.API_PASSPHRASE,
  };
  const CLOB = 'https://clob.polymarket.com';

  console.log('EOA:', EOA);
  console.log('Proxy:', proxy);
  console.log('API Key:', creds.key?.slice(0, 12) + '...');

  // 1) Testa L2 auth com endpoint v5 (/data/orders)
  console.log('\n=== 1) L2 AUTH com /data/orders (endpoint v5) ===');
  try {
    const client = new v5.ClobClient(CLOB, 137, wallet, creds, 1, proxy);
    const orders = await client.getOpenOrders();
    console.log('✅ L2 auth OK:', JSON.stringify(orders).slice(0, 200));
  } catch (e) {
    console.log('❌ L2 auth falhou:', e.message, JSON.stringify(e.response?.data || ''));
  }

  // 2) Testa sem proxy (sigType=0, EOA como maker)
  console.log('\n=== 2) L2 AUTH sigType=0 EOA (sem proxy) ===');
  try {
    const client0 = new v5.ClobClient(CLOB, 137, wallet, creds, 0, undefined);
    const orders0 = await client0.getOpenOrders();
    console.log('✅ sigType=0 auth OK:', JSON.stringify(orders0).slice(0, 200));
  } catch (e) {
    console.log('❌ sigType=0 falhou:', e.message);
  }

  // 3) Re-deriva credenciais com sigType=1 (proxy)
  console.log('\n=== 3) RE-DERIVA CREDENCIAIS (sigType=1, proxy) ===');
  try {
    const clientL1 = new v5.ClobClient(CLOB, 137, wallet, undefined, 1, proxy);
    const newCreds = await clientL1.deriveApiKey();
    console.log('✅ Credenciais derivadas:');
    console.log('  API_KEY=' + newCreds.key);
    console.log('  API_SECRET=' + newCreds.secret);
    console.log('  API_PASSPHRASE=' + newCreds.passphrase);

    // Testa L2 auth com as novas credenciais
    console.log('\n=== 3b) L2 AUTH com novas credenciais ===');
    const clientNew = new v5.ClobClient(CLOB, 137, wallet, newCreds, 1, proxy);
    const ordersNew = await clientNew.getOpenOrders();
    console.log('✅ Novas creds OK:', JSON.stringify(ordersNew).slice(0, 200));

    // Verifica proxy wallet correto para a EOA
    console.log('\n=== 3c) PROXY WALLET CORRETO para esta EOA ===');
    try {
      const axios = require('axios');
      const pw = await axios.get('https://clob.polymarket.com/proxy-wallet', { params: { address: EOA }, timeout: 8000 });
      console.log('Proxy wallet real da EOA:', JSON.stringify(pw.data));
      console.log('Proxy wallet no .env:    ', proxy);
    } catch(e) { console.log('Erro /proxy-wallet:', e.response?.status, e.message); }

    // Testa ordem e loga o objeto completo antes de enviar
    console.log('\n=== 3d) ORDEM + log do objeto assinado ===');
    const order = await clientNew.createOrder(
      { tokenID: '30919109558246209971545892228598482722881502507049010402392877610451001659386', price: 0.05, size: 1.0, side: v5.Side.BUY },
      { negRisk: true }
    );
    console.log('Ordem criada:', JSON.stringify(order, null, 2));
    const resp = await clientNew.postOrder(order, v5.OrderType.FOK, false);
    console.log('RESP:', JSON.stringify(resp));
  } catch (e) {
    console.log('❌ Erro:', e.message);
  }

  // 4) Re-deriva com sigType=0 (EOA puro, sem proxy)
  console.log('\n=== 4) RE-DERIVA sigType=0 EOA ===');
  try {
    const clientEOA = new v5.ClobClient(CLOB, 137, wallet, undefined, 0, undefined);
    const credsEOA = await clientEOA.deriveApiKey();
    console.log('EOA creds:', JSON.stringify(credsEOA));

    const clientTest = new v5.ClobClient(CLOB, 137, wallet, credsEOA, 0, undefined);
    const resp = await clientTest.createAndPostOrder(
      { tokenID: '30919109558246209971545892228598482722881502507049010402392877610451001659386', price: 0.05, size: 1.0, side: v5.Side.BUY },
      { negRisk: true },
      v5.OrderType.FOK,
      false
    );
    console.log('RESP sigType=0:', JSON.stringify(resp));
  } catch (e) {
    console.log('❌ EOA erro:', e.message);
  }
}

main().catch(console.error);
