'use strict';
require('dotenv').config({ override: true });
if (process.env.WEBSHARE_PROXY_URL) {
  process.env.GLOBAL_AGENT_HTTPS_PROXY = process.env.WEBSHARE_PROXY_URL;
  require('global-agent/bootstrap');
}
const { ethers } = require('ethers');

async function main() {
  const v5 = await import('clob-v5');
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY);
  const proxy  = process.env.PROXY_WALLET_ADDRESS;
  console.log('Proxy:', proxy);

  // RPC Polygon
  const provider = new ethers.providers.JsonRpcProvider('https://polygon-bor-rpc.publicnode.com');
  const bn = await provider.getBlockNumber();
  console.log('Bloco atual:', bn);

  const CTF_EXCHANGE = '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E';
  const NEG_EXCHANGE = '0xC5d563A36AE78145C45a50134d48A1215220f80a';

  // Testa vários nomes de função para ler o nonce do proxy
  const nonceAbis = [
    'function nonces(address) view returns (uint256)',
    'function cancelNonces(address) view returns (uint256)',
    'function minimumNonces(address) view returns (uint256)',
    'function getMinimumNonce(address) view returns (uint256)',
  ];

  console.log('\n=== Nonce do proxy no CTF Exchange ===');
  for (const abi of nonceAbis) {
    const fn = abi.match(/function (\w+)/)[1];
    try {
      const c = new ethers.Contract(CTF_EXCHANGE, [abi], provider);
      const n = await c[fn](proxy);
      console.log(`✅ CTF.${fn}(proxy): ${n.toString()}`);
    } catch { /* ignora */ }
  }

  console.log('\n=== Nonce do proxy no negRisk Exchange ===');
  for (const abi of nonceAbis) {
    const fn = abi.match(/function (\w+)/)[1];
    try {
      const c = new ethers.Contract(NEG_EXCHANGE, [abi], provider);
      const n = await c[fn](proxy);
      console.log(`✅ negEx.${fn}(proxy): ${n.toString()}`);
    } catch { /* ignora */ }
  }

  // Agora tenta criar uma ordem com nonce correto e coloca
  console.log('\n=== Teste de ordem com nonce atual ===');
  const TOKEN = '30919109558246209971545892228598482722881502507049010402392877610451001659386';
  const creds = { key: process.env.API_KEY, secret: process.env.API_SECRET, passphrase: process.env.API_PASSPHRASE };
  const client = new v5.ClobClient('https://clob.polymarket.com', 137, wallet, creds, 1, proxy);

  // Tenta nonces de 0 a 5
  for (const nonce of [0, 1, 2, 3, 4, 5]) {
    try {
      const order = await client.createOrder(
        { tokenID: TOKEN, price: 0.05, size: 1.0, side: v5.Side.BUY, nonce },
        { negRisk: true }
      );
      const resp = await client.postOrder(order, v5.OrderType.FOK, false);
      const err = resp?.error;
      console.log(`nonce=${nonce}: ${err || JSON.stringify(resp)?.slice(0,100)}`);
      if (!err) { console.log('✅ SUCESSO com nonce=' + nonce); break; }
    } catch(e) { console.log(`nonce=${nonce}: ERRO ${e.message?.slice(0,60)}`); }
  }
}

main().catch(console.error);
