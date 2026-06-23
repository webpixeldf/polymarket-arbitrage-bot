'use strict';
// Verifica qual é o proxy wallet correto para a EOA desta conta
require('dotenv').config({ override: true });
const { ethers } = require('ethers');
const axios = require('axios');

async function main() {
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY);
  const EOA = wallet.address;
  const proxyNoEnv = process.env.PROXY_WALLET_ADDRESS;
  const CLOB = 'https://clob.polymarket.com';

  console.log('EOA:', EOA);
  console.log('Proxy no .env:', proxyNoEnv);

  // 1) Busca o proxy wallet real da EOA via API Polymarket
  console.log('\n=== Proxy wallet real da EOA (via CLOB API) ===');
  try {
    const r = await axios.get(`${CLOB}/proxy-wallet`, { params: { address: EOA }, timeout: 8000 });
    console.log('Resposta /proxy-wallet:', JSON.stringify(r.data));
    const realProxy = r.data?.proxy_wallet ?? r.data;
    console.log('\nProxy REAL:', realProxy);
    console.log('Proxy no .env:', proxyNoEnv);
    if (realProxy && realProxy.toLowerCase() !== (proxyNoEnv || '').toLowerCase()) {
      console.log('\n❌ PROXY ERRADO NO .ENV!');
      console.log('Corrija o .env com:');
      console.log('PROXY_WALLET_ADDRESS=' + realProxy);
    } else {
      console.log('\n✅ Proxy wallet está correto no .env');
    }
  } catch (e) {
    console.log('Erro /proxy-wallet:', e.response?.status, JSON.stringify(e.response?.data || e.message));
  }

  // 2) Tenta via /accounts para ver se a conta existe
  console.log('\n=== Conta via /accounts ===');
  try {
    const r2 = await axios.get(`${CLOB}/accounts`, { params: { address: EOA }, timeout: 8000 });
    console.log('/accounts:', JSON.stringify(r2.data).slice(0, 300));
  } catch (e) {
    console.log('Erro /accounts:', e.response?.status, JSON.stringify(e.response?.data || e.message));
  }

  // 3) Verifica proxy via Gamma API
  console.log('\n=== Perfil via Gamma API ===');
  try {
    const r3 = await axios.get(`https://gamma-api.polymarket.com/profiles`, { params: { address: EOA }, timeout: 8000 });
    console.log('Gamma /profiles:', JSON.stringify(r3.data).slice(0, 300));
  } catch (e) {
    console.log('Erro Gamma /profiles:', e.response?.status, JSON.stringify(e.response?.data || e.message));
  }
}

main().catch(console.error);
