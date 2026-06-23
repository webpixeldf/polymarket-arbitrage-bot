// Diagnóstico completo: L2 auth + on-chain balance + order test
const { ClobClient, OrderType, Side } = require('@polymarket/clob-client');
const { ethers } = require('ethers');
require('dotenv').config({ override: true });

const CLOB_URL = 'https://clob.polymarket.com';

async function main() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) { console.error('PRIVATE_KEY não encontrado'); process.exit(1); }

  const wallet = new ethers.Wallet(pk);
  const EOA = wallet.address;
  const proxy = process.env.PROXY_WALLET_ADDRESS;

  console.log('\n=== ADDRESSES ===');
  console.log('EOA:  ', EOA);
  console.log('Proxy:', proxy);
  console.log('SigType:', process.env.SIGNATURE_TYPE);

  const creds = {
    key: process.env.API_KEY,
    secret: process.env.API_SECRET,
    passphrase: process.env.API_PASSPHRASE,
  };
  console.log('\n=== CREDENCIAIS ===');
  console.log('Key:', creds.key);
  console.log('Secret:', creds.secret?.slice(0, 10) + '...');

  const sigType = parseInt(process.env.SIGNATURE_TYPE ?? '1');
  const client = new ClobClient(CLOB_URL, 137, wallet, creds, sigType, proxy);

  // 1) Teste L2 auth com GET /orders
  console.log('\n=== TESTE L2 AUTH (GET /orders) ===');
  try {
    const orders = await client.getOpenOrders();
    console.log('✅ L2 auth OK — open orders:', JSON.stringify(orders).slice(0, 200));
  } catch (e) {
    console.error('❌ L2 auth FALHOU:', e.message);
  }

  // 2) Balance/allowance
  console.log('\n=== BALANCE/ALLOWANCE ===');
  try {
    const bal = await client.getBalanceAllowance({ asset_type: 'USDC' });
    console.log('USDC:', JSON.stringify(bal));
  } catch (e) {
    console.error('Balance error:', e.message);
  }

  // 3) Testa ordem num mercado com alta liquidez (Ankara YES)
  const TOKEN_ID = '56441613474608958357488383796816307365995276962960033087501461366776172243406';
  console.log('\n=== TESTE ORDER (YES@15¢ negRisk) ===');
  try {
    const order = await client.createOrder({
      tokenID: TOKEN_ID,
      price: 0.15,
      size: 1.0,
      side: Side.BUY,
    }, { negRisk: true });
    console.log('Ordem criada:', JSON.stringify({
      maker: order.maker,
      signer: order.signer,
      signatureType: order.signatureType,
      makerAmount: order.makerAmount,
      takerAmount: order.takerAmount,
      sig: order.signature?.slice(0, 20),
    }));
    const resp = await client.postOrder(order, OrderType.FOK);
    console.log('POST resp:', JSON.stringify(resp));
  } catch (e) {
    console.error('Order test erro:', e.message);
  }

  // 4) Testa signatureType=0 (EOA direto, sem proxy)
  console.log('\n=== TESTE sigType=0 EOA (sem proxy) ===');
  try {
    const clientEOA = new ClobClient(CLOB_URL, 137, wallet, creds, 0, undefined);
    const order0 = await clientEOA.createOrder({
      tokenID: TOKEN_ID,
      price: 0.15,
      size: 1.0,
      side: Side.BUY,
    }, { negRisk: true });
    console.log('sigType0 maker:', order0.maker, '| signer:', order0.signer);
    const resp0 = await clientEOA.postOrder(order0, OrderType.FOK);
    console.log('POST sigType0:', JSON.stringify(resp0));
  } catch (e) {
    console.error('sigType0 erro:', e.message);
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
