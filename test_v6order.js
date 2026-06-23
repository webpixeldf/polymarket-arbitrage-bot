'use strict';
// Novo esquema de assinatura EIP-712 descoberto via MetaMask (jun/2026)
// signatureType=3, domain "DepositWallet", proxy como maker/signer/verifyingContract
require('dotenv').config({ override: true });
if (process.env.WEBSHARE_PROXY_URL) {
  process.env.GLOBAL_AGENT_HTTPS_PROXY = process.env.WEBSHARE_PROXY_URL;
  require('global-agent/bootstrap');
}
const { ethers } = require('ethers');
const axios   = require('axios');
const crypto  = require('crypto');

const ZERO_B32 = '0x' + '0'.repeat(64);

async function buildL2Headers(creds, method, requestPath, body) {
  const ts  = Math.floor(Date.now() / 1000).toString();
  const msg = ts + method.toUpperCase() + requestPath + (body || '');
  const secret = Buffer.from(creds.secret.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const sig = crypto.createHmac('sha256', secret).update(msg).digest('base64');
  return {
    'POLY_ADDRESS':    creds.key,
    'POLY_SIGNATURE':  sig,
    'POLY_TIMESTAMP':  ts,
    'POLY_PASSPHRASE': creds.passphrase,
    'Content-Type':    'application/json',
    'User-Agent':      '@polymarket/clob-client',
    'Accept':          '*/*',
  };
}

async function postOrderNew({ wallet, creds, proxyWallet, tokenID, price, size, buyOrSell, orderType = 'GTC' }) {
  const CLOB = 'https://clob.polymarket.com';
  const D6   = 1_000_000;
  const side = buyOrSell === 'BUY' ? 0 : 1;

  // Calcula amounts (sem feeRateBps — fee está embutido na cotação)
  let makerAmount, takerAmount;
  if (buyOrSell === 'BUY') {
    makerAmount = Math.round(price * size * D6);
    takerAmount = Math.floor(makerAmount / price); // tokens recebidos
  } else {
    makerAmount = Math.round(size * D6);           // tokens vendidos
    takerAmount = Math.floor(price * size * D6);   // USDC recebidos
  }

  const salt      = BigInt('0x' + crypto.randomBytes(8).toString('hex')).toString();
  const timestamp = Date.now().toString(); // milissegundos!

  // Novo domínio EIP-712: DepositWallet, verifyingContract = PROXY
  const domain = {
    name:              'DepositWallet',
    version:           '1',
    chainId:           137,
    verifyingContract: proxyWallet,
    salt:              ZERO_B32,
  };

  // Nova estrutura TypedDataSign
  const types = {
    TypedDataSign: [
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
    ],
  };

  const message = {
    salt,
    maker:         proxyWallet,
    signer:        proxyWallet,
    tokenId:       tokenID,
    makerAmount:   makerAmount.toString(),
    takerAmount:   takerAmount.toString(),
    timestamp,
    side,
    signatureType: 3,
    metadata:      ZERO_B32,
    builder:       ZERO_B32,
  };

  // EOA assina pelo proxy (ERC-1271)
  const signature = await wallet._signTypedData(domain, types, message);

  const orderPayload = {
    order: {
      ...message,
      makerAmount: message.makerAmount,
      takerAmount: message.takerAmount,
      signature,
    },
    owner:     creds.key,
    orderType,
  };

  console.log('Payload:', JSON.stringify(orderPayload, null, 2));

  const bodyStr = JSON.stringify(orderPayload);
  const headers = await buildL2Headers(creds, 'POST', '/order', bodyStr);

  try {
    const resp = await axios.post(`${CLOB}/order`, orderPayload, { headers, timeout: 15000 });
    return resp.data;
  } catch(e) {
    return e.response?.data || { error: e.message };
  }
}

async function main() {
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY);
  const proxy  = process.env.PROXY_WALLET_ADDRESS;
  const creds  = { key: process.env.API_KEY, secret: process.env.API_SECRET, passphrase: process.env.API_PASSPHRASE };

  console.log('EOA  :', wallet.address);
  console.log('Proxy:', proxy);

  // Busca um mercado ATIVO com liquidez para testar
  console.log('\nBuscando mercado ativo...');
  const markets = await axios.get('https://clob.polymarket.com/markets', {
    params: { active: true, closed: false, limit: 20 },
    timeout: 8000,
  }).catch(e => ({ data: { data: [] } }));

  const list = markets.data?.data || markets.data || [];
  let TOKEN = null, marketName = null;
  for (const m of list) {
    const tokens = m.tokens || [];
    for (const t of tokens) {
      if (t.token_id && m.active && !m.closed) {
        TOKEN = t.token_id;
        marketName = m.question || m.market_slug;
        break;
      }
    }
    if (TOKEN) break;
  }

  if (!TOKEN) {
    console.log('Usando token fallback (Nikki Haley 2028)');
    TOKEN = '30919109558246209971545892228598482722881502507049010402392877610451001659386';
    marketName = 'Nikki Haley 2028';
  }
  console.log('Token:', TOKEN);
  console.log('Mercado:', marketName);

  // Teste 1: GTC BUY $1 (makerAmount=1000000)
  console.log('\n=== TESTE 1: GTC BUY $1, side=0 (integer) ===');
  const r1 = await postOrderNew({
    wallet, creds, proxyWallet: proxy,
    tokenID: TOKEN, price: 0.50, size: 2.0,  // $1 total
    buyOrSell: 'BUY', orderType: 'GTC',
  });
  console.log('Resultado:', JSON.stringify(r1));
  if (!r1?.error) {
    console.log('✅ SUCESSO! Cancelando...');
    const h = await buildL2Headers(creds, 'DELETE', '/order', JSON.stringify({ orderID: r1.orderID }));
    await axios.delete('https://clob.polymarket.com/order', { data: { orderID: r1.orderID }, headers: h }).catch(() => {});
  }

  // Teste 2: mesmo mas com side como string "BUY"
  console.log('\n=== TESTE 2: GTC BUY $1, side="BUY" (string) ===');
  const origPostOrder = postOrderNew;
  // Patch temporário: envia side como string
  const D6 = 1_000_000;
  const salt2 = BigInt('0x' + crypto.randomBytes(8).toString('hex')).toString();
  const ts2 = Date.now().toString();
  const ma2 = Math.round(0.50 * 2.0 * D6);
  const ta2 = Math.floor(ma2 / 0.50);
  const domain2 = { name: 'DepositWallet', version: '1', chainId: 137, verifyingContract: proxy, salt: ZERO_B32 };
  const types2 = { TypedDataSign: [
    { name: 'salt', type: 'uint256' }, { name: 'maker', type: 'address' }, { name: 'signer', type: 'address' },
    { name: 'tokenId', type: 'uint256' }, { name: 'makerAmount', type: 'uint256' }, { name: 'takerAmount', type: 'uint256' },
    { name: 'timestamp', type: 'uint256' }, { name: 'side', type: 'uint8' }, { name: 'signatureType', type: 'uint8' },
    { name: 'metadata', type: 'bytes32' }, { name: 'builder', type: 'bytes32' },
  ]};
  const msg2 = { salt: salt2, maker: proxy, signer: proxy, tokenId: TOKEN,
    makerAmount: ma2.toString(), takerAmount: ta2.toString(), timestamp: ts2,
    side: 0, signatureType: 3, metadata: ZERO_B32, builder: ZERO_B32 };
  const sig2 = await wallet._signTypedData(domain2, types2, msg2);
  const payload2 = { order: { ...msg2, side: 'BUY', signature: sig2 }, owner: creds.key, orderType: 'GTC' };
  const body2 = JSON.stringify(payload2);
  const h2 = await buildL2Headers(creds, 'POST', '/order', body2);
  const r2 = await axios.post('https://clob.polymarket.com/order', payload2, { headers: h2, timeout: 15000 }).then(r => r.data).catch(e => e.response?.data);
  console.log('Resultado:', JSON.stringify(r2));
  if (!r2?.error && r2?.orderID) {
    const h = await buildL2Headers(creds, 'DELETE', '/order', JSON.stringify({ orderID: r2.orderID }));
    await axios.delete('https://clob.polymarket.com/order', { data: { orderID: r2.orderID }, headers: h }).catch(() => {});
    console.log('✅ SUCESSO com side="BUY"!');
  }
}

main().catch(console.error);
