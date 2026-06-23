'use strict';
// Verifica se o ecrecover local retorna o EOA correto (confirma se o EIP-712 está certo)
// e testa assinatura nula para isolar problema de formato vs assinatura
require('dotenv').config({ override: true });
if (process.env.WEBSHARE_PROXY_URL) {
  process.env.GLOBAL_AGENT_HTTPS_PROXY = process.env.WEBSHARE_PROXY_URL;
  require('global-agent/bootstrap');
}
const { ethers } = require('ethers');
const axios  = require('axios');
const crypto = require('crypto');

const ZERO_B32 = '0x' + '0'.repeat(64);

async function buildL2Headers(creds, method, requestPath, body) {
  const ts  = Math.floor(Date.now() / 1000).toString();
  const msg = ts + method.toUpperCase() + requestPath + (body || '');
  const secret = Buffer.from(creds.secret.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const sig = crypto.createHmac('sha256', secret).update(msg).digest('base64');
  return { 'POLY_ADDRESS': creds.key, 'POLY_SIGNATURE': sig, 'POLY_TIMESTAMP': ts,
           'POLY_PASSPHRASE': creds.passphrase, 'Content-Type': 'application/json',
           'User-Agent': '@polymarket/clob-client', 'Accept': '*/*' };
}

async function main() {
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY);
  const proxy  = process.env.PROXY_WALLET_ADDRESS;
  const creds  = { key: process.env.API_KEY, secret: process.env.API_SECRET, passphrase: process.env.API_PASSPHRASE };

  const TOKEN  = '30919109558246209971545892228598482722881502507049010402392877610451001659386';
  const salt   = Math.ceil(Math.random() * 1e13).toString();
  const ts     = Date.now().toString();

  const domain = { name: 'DepositWallet', version: '1', chainId: 137, verifyingContract: proxy, salt: ZERO_B32 };
  const types  = { TypedDataSign: [
    { name: 'salt',          type: 'uint256' },
    { name: 'maker',         type: 'address' },
    { name: 'signer',        type: 'address' },
    { name: 'tokenId',       type: 'uint256' },
    { name: 'makerAmount',   type: 'uint256' },
    { name: 'takerAmount',   type: 'uint256' },
    { name: 'timestamp',     type: 'uint256' },
    { name: 'side',          type: 'uint8'   },
    { name: 'signatureType', type: 'uint8'   },
    { name: 'metadata',      type: 'bytes32' },
    { name: 'builder',       type: 'bytes32' },
  ]};
  const message = { salt, maker: proxy, signer: proxy, tokenId: TOKEN,
    makerAmount: '2000000', takerAmount: '4000000', timestamp: ts,
    side: 0, signatureType: 3, metadata: ZERO_B32, builder: ZERO_B32 };

  // 1) Verifica ecrecover LOCAL
  console.log('=== 1) Verificação local do ecrecover ===');
  const sig = await wallet._signTypedData(domain, types, message);
  const hash = ethers.utils._TypedDataEncoder.hash(domain, types, message);
  const recovered = ethers.utils.recoverAddress(hash, sig);
  console.log('EOA (chave privada):', wallet.address);
  console.log('Recuperado (ecrecover):', recovered);
  console.log('✅ Bate:', recovered.toLowerCase() === wallet.address.toLowerCase());

  const orderBase = { salt, maker: proxy, signer: proxy, tokenId: TOKEN,
    makerAmount: '2000000', takerAmount: '4000000', timestamp: ts,
    side: 0, signatureType: 3, metadata: ZERO_B32, builder: ZERO_B32 };

  // 2) Testa com assinatura NULA (para ver se erro muda)
  console.log('\n=== 2) Assinatura nula (detecta se formato está ok) ===');
  const payloadNull = { order: { ...orderBase, signature: '0x' + '0'.repeat(130) }, owner: creds.key, orderType: 'GTC' };
  const b1 = JSON.stringify(payloadNull);
  const r1 = await axios.post('https://clob.polymarket.com/order', payloadNull,
    { headers: await buildL2Headers(creds, 'POST', '/order', b1), timeout: 15000 })
    .then(r => r.data).catch(e => e.response?.data);
  console.log('Resultado assinatura nula:', JSON.stringify(r1));

  // 3) Testa com assinatura REAL
  console.log('\n=== 3) Assinatura real (EOA sign) ===');
  const payloadReal = { order: { ...orderBase, signature: sig }, owner: creds.key, orderType: 'GTC' };
  const b2 = JSON.stringify(payloadReal);
  const r2 = await axios.post('https://clob.polymarket.com/order', payloadReal,
    { headers: await buildL2Headers(creds, 'POST', '/order', b2), timeout: 15000 })
    .then(r => r.data).catch(e => e.response?.data);
  console.log('Resultado assinatura real:', JSON.stringify(r2));

  // 4) Testa com verifyingContract = endereço do contrato "Interacting with"
  // 0xE111...B996B — o contrato que aparece no MetaMask "Interacting with"
  // (apenas os últimos e primeiros chars visíveis no screenshot)
  // Tentamos: e se o verifyingContract correto não é o proxy mas outro contrato?
  console.log('\n=== 4) verifyingContract alternativo (tenta deduzir 0xE111...B996B) ===');
  // Vamos buscar o endereço real via Polygon (contrato que o proxy chama)
  const provider = new ethers.providers.JsonRpcProvider('https://polygon-bor-rpc.publicnode.com');
  const proxyAbi = [
    'function owner() view returns (address)',
    'function getOwner() view returns (address)',
    'function implementation() view returns (address)',
  ];
  for (const fn of ['owner', 'getOwner', 'implementation']) {
    try {
      const c = new ethers.Contract(proxy, [`function ${fn}() view returns (address)`], provider);
      const v = await c[fn]();
      console.log(`proxy.${fn}():`, v);
    } catch {}
  }
}

main().catch(console.error);
