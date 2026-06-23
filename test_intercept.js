'use strict';
// IMPORTANTE: adicionar interceptores ANTES de importar global-agent e v5
require('dotenv').config({ override: true });

// 1) Intercepta o axios GLOBAL antes de qualquer coisa
const axios = require('axios');
axios.interceptors.request.use(req => {
  if (req.url?.includes('/order')) {
    console.log('\n[→ URL]', req.url);
    console.log('[→ BODY]', JSON.stringify(req.data, null, 2)?.slice(0, 600));
    console.log('[→ POLY_ADDRESS]', req.headers?.POLY_ADDRESS);
    console.log('[→ POLY_TIMESTAMP]', req.headers?.POLY_TIMESTAMP);
  }
  return req;
});
axios.interceptors.response.use(
  resp => {
    if (resp.config?.url?.includes('/order')) {
      console.log('[← STATUS]', resp.status, '| DATA:', JSON.stringify(resp.data));
    }
    return resp;
  },
  err => {
    if (err.config?.url?.includes('/order')) {
      console.log('[← ERR STATUS]', err.response?.status);
      console.log('[← ERR BODY]', JSON.stringify(err.response?.data));
      console.log('[← ERR HEADERS]', JSON.stringify(err.response?.headers));
    }
    return Promise.reject(err);
  }
);

// 2) Só então ativa o proxy
if (process.env.WEBSHARE_PROXY_URL) {
  process.env.GLOBAL_AGENT_HTTPS_PROXY = process.env.WEBSHARE_PROXY_URL;
  require('global-agent/bootstrap');
}

const { ethers } = require('ethers');

async function main() {
  const v5 = await import('clob-v5');
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY);
  const proxy  = process.env.PROXY_WALLET_ADDRESS;
  const creds  = { key: process.env.API_KEY, secret: process.env.API_SECRET, passphrase: process.env.API_PASSPHRASE };
  const CLOB   = 'https://clob.polymarket.com';
  const TOKEN  = '46788745865873849751895851580006231458025441200398102606849707486161173481896';

  console.log('EOA  :', wallet.address);
  console.log('Proxy:', proxy);

  // Teste 1: signatureType=1 (POLY_PROXY) — nosso método atual
  console.log('\n=== TESTE 1: signatureType=1 (POLY_PROXY) ===');
  {
    const client = new v5.ClobClient(CLOB, 137, wallet, creds, 1, proxy);
    const order = await client.createOrder(
      { tokenID: TOKEN, price: 0.50, size: 1.0, side: v5.Side.BUY },
      { negRisk: true }
    );
    console.log('Order signatureType:', order.signatureType);
    console.log('Order maker:', order.maker);
    console.log('Order signer:', order.signer);
    const resp = await client.postOrder(order, v5.OrderType.GTC, false);
    console.log('Resultado:', JSON.stringify(resp));
  }

  // Teste 2: signatureType=0 (EOA direto, sem proxy)
  console.log('\n=== TESTE 2: signatureType=0 (EOA como maker) ===');
  {
    // signatureType=0: maker=EOA, signer=EOA, sem proxy
    const client = new v5.ClobClient(CLOB, 137, wallet, creds, 0);
    const order = await client.createOrder(
      { tokenID: TOKEN, price: 0.50, size: 1.0, side: v5.Side.BUY },
      { negRisk: true }
    );
    console.log('Order signatureType:', order.signatureType);
    console.log('Order maker:', order.maker);
    console.log('Order signer:', order.signer);
    const resp = await client.postOrder(order, v5.OrderType.GTC, false);
    console.log('Resultado:', JSON.stringify(resp));
  }

  // Teste 3: signatureType=1 com negRisk=false (usa CTF Exchange no domínio)
  console.log('\n=== TESTE 3: signatureType=1, negRisk=false ===');
  {
    const client = new v5.ClobClient(CLOB, 137, wallet, creds, 1, proxy);
    const order = await client.createOrder(
      { tokenID: TOKEN, price: 0.50, size: 1.0, side: v5.Side.BUY },
      { negRisk: false }  // força CTF Exchange para assinar
    );
    console.log('Order signatureType:', order.signatureType);
    const resp = await client.postOrder(order, v5.OrderType.GTC, false);
    console.log('Resultado:', JSON.stringify(resp));
  }
}

main().catch(console.error);
