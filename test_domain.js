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
  const proxy  = process.env.PROXY_WALLET_ADDRESS;
  const creds  = { key: process.env.API_KEY, secret: process.env.API_SECRET, passphrase: process.env.API_PASSPHRASE };

  const provider = new ethers.providers.JsonRpcProvider('https://polygon-bor-rpc.publicnode.com');

  const CTF_EXCHANGE = '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E';
  const NEG_EXCHANGE = '0xC5d563A36AE78145C45a50134d48A1215220f80a';

  // 1) Lê DOMAIN_SEPARATOR on-chain
  console.log('=== 1) DOMAIN_SEPARATOR on-chain ===');
  const domAbi = ['function DOMAIN_SEPARATOR() view returns (bytes32)'];
  const ctfDs = await new ethers.Contract(CTF_EXCHANGE, domAbi, provider).DOMAIN_SEPARATOR().catch(e => 'ERRO: ' + e.code);
  const negDs = await new ethers.Contract(NEG_EXCHANGE, domAbi, provider).DOMAIN_SEPARATOR().catch(e => 'ERRO: ' + e.code);
  console.log('CTF Exchange DOMAIN_SEPARATOR:', ctfDs);
  console.log('negRisk Exchange DOMAIN_SEPARATOR:', negDs);

  // 2) Computa DOMAIN_SEPARATOR local (como v5 usaria)
  console.log('\n=== 2) DOMAIN_SEPARATOR local (v5 config) ===');
  const computeDomain = (name, version, verifyingContract) => {
    return ethers.utils._TypedDataEncoder.hashDomain({
      name, version, chainId: 137, verifyingContract
    });
  };
  // Testa múltiplos nomes/versões que v5 poderia usar
  const variants = [
    { name: 'Polymarket CTF Exchange', version: '1' },
    { name: 'ClobAuthDomain', version: '1' },
    { name: 'Polymarket', version: '1' },
    { name: 'Polymarket CTF Exchange', version: '2' },
  ];
  for (const v of variants) {
    const ds = computeDomain(v.name, v.version, NEG_EXCHANGE);
    const match = ds === negDs ? '✅ BATE!' : '';
    console.log(`neg "${v.name}" v${v.version}: ${ds} ${match}`);
  }

  // 3) Busca detalhes do trade histórico
  console.log('\n=== 3) Detalhes completos do trade histórico ===');
  const client = new v5.ClobClient('https://clob.polymarket.com', 137, wallet, creds, 1, proxy);
  try {
    const trades = await client.getTrades({ maker_address: proxy });
    console.log('Trades completos:', JSON.stringify(trades, null, 2)?.slice(0, 1000));
  } catch(e) { console.log('Erro getTrades:', e.message); }

  // 4) Tenta GTC em vez de FOK (outra via de execução)
  console.log('\n=== 4) Teste com GTC (Good Till Cancelled) ===');
  const TOKEN = '30919109558246209971545892228598482722881502507049010402392877610451001659386';
  try {
    const order = await client.createOrder(
      { tokenID: TOKEN, price: 0.50, size: 2.0, side: v5.Side.BUY },
      { negRisk: true }
    );
    const resp = await client.postOrder(order, v5.OrderType.GTC, false);
    console.log('GTC RESP:', JSON.stringify(resp));
    // Cancela a ordem se criada com sucesso
    if (resp?.orderID || resp?.order?.id) {
      const id = resp?.orderID || resp?.order?.id;
      const cancel = await client.cancelOrder({ orderID: id });
      console.log('Cancel:', JSON.stringify(cancel));
    }
  } catch(e) { console.log('Erro GTC:', e.message); }

  // 5) Testa com token do trade histórico
  console.log('\n=== 5) Teste com token do trade histórico ===');
  const HIST_TOKEN = '46788745865873849751895851580006231458025441200398102606849707486161173481896';
  try {
    const [feeR, nrR] = await Promise.all([
      axios.get('https://clob.polymarket.com/fee-rate', { params: { token_id: HIST_TOKEN }, timeout: 5000 }),
      axios.get('https://clob.polymarket.com/neg-risk', { params: { token_id: HIST_TOKEN }, timeout: 5000 }),
    ]);
    console.log('fee:', feeR.data?.base_fee, 'negRisk:', nrR.data?.neg_risk);
    const order2 = await client.createOrder(
      { tokenID: HIST_TOKEN, price: 0.50, size: 2.0, side: v5.Side.BUY },
      { negRisk: nrR.data?.neg_risk === true }
    );
    const resp2 = await client.postOrder(order2, v5.OrderType.GTC, false);
    console.log('Token histórico RESP:', JSON.stringify(resp2));
    if (resp2?.orderID) await client.cancelOrder({ orderID: resp2.orderID });
  } catch(e) { console.log('Erro token histórico:', e.message); }
}

main().catch(console.error);
