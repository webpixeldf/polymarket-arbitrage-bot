'use strict';
// Verifica on-chain: saldo USDC do proxy, aprovação EOA→proxy, e registros no Exchange
require('dotenv').config({ override: true });
if (process.env.WEBSHARE_PROXY_URL) {
  process.env.GLOBAL_AGENT_HTTPS_PROXY = process.env.WEBSHARE_PROXY_URL;
  require('global-agent/bootstrap');
}
const { ethers } = require('ethers');

async function main() {
  const EOA   = new ethers.Wallet(process.env.PRIVATE_KEY).address;
  const proxy = process.env.PROXY_WALLET_ADDRESS;
  console.log('EOA:  ', EOA);
  console.log('Proxy:', proxy);

  // Tenta múltiplos RPCs da Polygon até um funcionar
  const RPCS = [
    'https://polygon.llamarpc.com',
    'https://rpc.ankr.com/polygon',
    'https://polygon-bor-rpc.publicnode.com',
    'https://polygon-rpc.com',
  ];
  let provider = null;
  for (const rpc of RPCS) {
    try {
      const p = new ethers.providers.JsonRpcProvider(rpc);
      const bn = await p.getBlockNumber();
      console.log(`RPC OK: ${rpc} (bloco ${bn})`);
      provider = p;
      break;
    } catch { console.log(`RPC falhou: ${rpc}`); }
  }
  if (!provider) { console.log('Nenhum RPC funcionou'); return; }

  // USDC e USDC.e na Polygon
  const USDC  = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'; // native USDC
  const USDCe = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'; // USDC.e (bridged)
  const erc20 = ['function balanceOf(address) view returns (uint256)'];

  const usdcContract  = new ethers.Contract(USDC,  erc20, provider);
  const usdceContract = new ethers.Contract(USDCe, erc20, provider);

  // Saldo USDC do PROXY
  const [proxyUsdc, proxyUsdce, eoaUsdc, eoaUsdce] = await Promise.all([
    usdcContract.balanceOf(proxy).catch(() => ethers.BigNumber.from(0)),
    usdceContract.balanceOf(proxy).catch(() => ethers.BigNumber.from(0)),
    usdcContract.balanceOf(EOA).catch(() => ethers.BigNumber.from(0)),
    usdceContract.balanceOf(EOA).catch(() => ethers.BigNumber.from(0)),
  ]);
  console.log('\n=== Saldos USDC on-chain ===');
  console.log(`Proxy USDC (native): $${(proxyUsdc / 1e6).toFixed(2)}`);
  console.log(`Proxy USDC.e:        $${(proxyUsdce / 1e6).toFixed(2)}`);
  console.log(`EOA   USDC (native): $${(eoaUsdc / 1e6).toFixed(2)}`);
  console.log(`EOA   USDC.e:        $${(eoaUsdce / 1e6).toFixed(2)}`);

  // Conta de transações do proxy (nonce = número de tx enviadas)
  const proxyNonce = await provider.getTransactionCount(proxy).catch(() => -1);
  const eoaNonce   = await provider.getTransactionCount(EOA).catch(() => -1);
  console.log('\n=== Nonces (tx enviadas) ===');
  console.log(`Proxy tx count: ${proxyNonce}`);
  console.log(`EOA   tx count: ${eoaNonce}`);

  // MATIC (gas) balance
  const [maticProxy, maticEoa] = await Promise.all([
    provider.getBalance(proxy).catch(() => ethers.BigNumber.from(0)),
    provider.getBalance(EOA).catch(() => ethers.BigNumber.from(0)),
  ]);
  console.log('\n=== Saldo MATIC (gas) ===');
  console.log(`Proxy MATIC: ${ethers.utils.formatEther(maticProxy)} MATIC`);
  console.log(`EOA   MATIC: ${ethers.utils.formatEther(maticEoa)} MATIC`);

  // Testa múltiplos ABIs para checar aprovação de operador
  const CTF_EXCHANGE = '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E';
  const NEG_EXCHANGE = '0xC5d563A36AE78145C45a50134d48A1215220f80a';
  const CTF_TOKENS   = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045'; // ConditionalTokens ERC1155

  console.log('\n=== Aprovação de operador (várias assinaturas) ===');
  const checks = [
    { contract: CTF_EXCHANGE, name: 'Exchange.isOperator(proxy,eoa)',     abi: 'function isOperator(address,address) view returns (bool)',     args: [proxy, EOA] },
    { contract: CTF_EXCHANGE, name: 'Exchange.isApprovedForAll(proxy,eoa)',abi: 'function isApprovedForAll(address,address) view returns (bool)',args: [proxy, EOA] },
    { contract: CTF_TOKENS,   name: 'CTF.isApprovedForAll(proxy,exchange)',abi: 'function isApprovedForAll(address,address) view returns (bool)',args: [proxy, CTF_EXCHANGE] },
    { contract: NEG_EXCHANGE, name: 'negEx.isOperator(proxy,eoa)',         abi: 'function isOperator(address,address) view returns (bool)',     args: [proxy, EOA] },
  ];
  for (const c of checks) {
    try {
      const contract = new ethers.Contract(c.contract, [c.abi], provider);
      const fn = Object.keys(contract.functions)[0];
      const result = await contract[fn](...c.args);
      console.log(`✅ ${c.name}: ${result}`);
    } catch (e) {
      console.log(`❌ ${c.name}: ${e.code || e.message.slice(0, 60)}`);
    }
  }

  // Busca proxy via v5 API
  console.log('\n=== Proxy wallet via v5 getProxyWallet ===');
  try {
    const v5 = await import('clob-v5');
    const creds = { key: process.env.API_KEY, secret: process.env.API_SECRET, passphrase: process.env.API_PASSPHRASE };
    const client = new v5.ClobClient('https://clob.polymarket.com', 137, new ethers.Wallet(process.env.PRIVATE_KEY), creds, 1, proxy);
    const pw = await client.getProxyWallet(EOA);
    console.log('getProxyWallet:', JSON.stringify(pw));
  } catch(e) { console.log('Erro getProxyWallet:', e.message?.slice(0,100)); }
}

main().catch(console.error);
