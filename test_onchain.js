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

  // Verifica se EOA é operador aprovado para o proxy no CTF Exchange
  const CTF_EXCHANGE = '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E';
  const NEG_EXCHANGE = '0xC5d563A36AE78145C45a50134d48A1215220f80a';
  const approvalAbi  = ['function isApprovedForAll(address owner, address operator) view returns (bool)'];

  const ctf = new ethers.Contract(CTF_EXCHANGE, approvalAbi, provider);
  const neg = new ethers.Contract(NEG_EXCHANGE, approvalAbi, provider);

  const [ctfApproved, negApproved] = await Promise.all([
    ctf.isApprovedForAll(proxy, EOA).catch(() => 'ERRO'),
    neg.isApprovedForAll(proxy, EOA).catch(() => 'ERRO'),
  ]);
  console.log('\n=== EOA aprovada como operador do Proxy? ===');
  console.log(`CTF Exchange   (0x4bFb...): ${ctfApproved}`);
  console.log(`negRisk Exchange (0xC5d5...): ${negApproved}`);

  // Verifica allowance do proxy para o Exchange
  const allowanceAbi = ['function allowance(address owner, address spender) view returns (uint256)'];
  const usdcA  = new ethers.Contract(USDC,  allowanceAbi, provider);
  const usdceA = new ethers.Contract(USDCe, allowanceAbi, provider);

  const [al1, al2] = await Promise.all([
    usdcA.allowance(proxy, CTF_EXCHANGE).catch(() => ethers.BigNumber.from(0)),
    usdceA.allowance(proxy, CTF_EXCHANGE).catch(() => ethers.BigNumber.from(0)),
  ]);
  console.log('\n=== Allowance USDC do Proxy para CTF Exchange ===');
  console.log(`USDC native: $${(al1 / 1e6).toFixed(2)}`);
  console.log(`USDC.e:      $${(al2 / 1e6).toFixed(2)}`);
}

main().catch(console.error);
