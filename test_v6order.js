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

  // Busca mercado ativo via Gamma API
  console.log('\nBuscando mercado ativo via Gamma...');
  let TOKEN = null, marketName = null, bestPrice = 0.50;
  try {
    const gam = await axios.get('https://gamma-api.polymarket.com/markets', {
      params: { active: true, closed: false, limit: 10, order: 'volume24hr', ascending: false },
      timeout: 8000,
    });
    const list = Array.isArray(gam.data) ? gam.data : gam.data?.markets || [];
    for (const m of list) {
      const tokens = m.clobTokenIds || m.tokens || [];
      const tid = Array.isArray(tokens) ? tokens[0] : tokens?.yes;
      if (tid && !m.closed && m.active !== false) {
        TOKEN = tid; marketName = m.question || m.slug;
        bestPrice = parseFloat(m.bestBid || m.bestAsk || 0.50) || 0.50;
        break;
      }
    }
  } catch(e) { console.log('Gamma fallback:', e.message?.slice(0,40)); }

  if (!TOKEN) {
    TOKEN = '30919109558246209971545892228598482722881502507049010402392877610451001659386';
    marketName = 'Nikki Haley 2028'; bestPrice = 0.06;
  }
  console.log('Token:', TOKEN);
  console.log('Mercado:', marketName, '| Preço ~', bestPrice);

  const tryOrder = async (label, overrides) => {
    const D6   = 1_000_000;
    const p    = overrides.price    ?? 0.50;
    const s    = overrides.size     ?? 2.0;
    const side = overrides.side     ?? 0;
    const ts   = overrides.tsMs     ? Date.now().toString()
                                    : Math.floor(Date.now() / 1000).toString();
    const ma   = Math.round(p * s * D6);
    const ta   = Math.floor(ma / p);
    const salt = BigInt('0x' + crypto.randomBytes(8).toString('hex')).toString();
    const tok  = overrides.tokenID ?? TOKEN;

    const domain = { name: 'DepositWallet', version: '1', chainId: 137, verifyingContract: proxy, salt: ZERO_B32 };
    const types  = { TypedDataSign: [
      { name: 'salt', type: 'uint256' }, { name: 'maker', type: 'address' }, { name: 'signer', type: 'address' },
      { name: 'tokenId', type: 'uint256' }, { name: 'makerAmount', type: 'uint256' }, { name: 'takerAmount', type: 'uint256' },
      { name: 'timestamp', type: 'uint256' }, { name: 'side', type: 'uint8' }, { name: 'signatureType', type: 'uint8' },
      { name: 'metadata', type: 'bytes32' }, { name: 'builder', type: 'bytes32' },
    ]};
    const msg = { salt, maker: proxy, signer: proxy, tokenId: tok,
      makerAmount: ma.toString(), takerAmount: ta.toString(), timestamp: ts,
      side, signatureType: 3, metadata: ZERO_B32, builder: ZERO_B32 };
    const sig = await wallet._signTypedData(domain, types, msg);

    const postSide  = overrides.sideStr ? 'BUY' : side;
    const negRisk   = overrides.negRisk;
    const payload   = { order: { ...msg, side: postSide, signature: sig }, owner: creds.key, orderType: 'GTC',
                        ...(negRisk !== undefined ? { negRisk } : {}) };
    const bodyStr   = JSON.stringify(payload);
    const headers   = await buildL2Headers(creds, 'POST', '/order', bodyStr);
    const result    = await axios.post('https://clob.polymarket.com/order', payload, { headers, timeout: 15000 })
                        .then(r => r.data).catch(e => e.response?.data || { error: e.message });
    console.log(`${label}: ${JSON.stringify(result)}`);
    if (!result?.error && result?.orderID) {
      console.log('✅ SUCESSO!');
      const hd = await buildL2Headers(creds, 'DELETE', '/order', JSON.stringify({ orderID: result.orderID }));
      await axios.delete('https://clob.polymarket.com/order', { data: { orderID: result.orderID }, headers: hd }).catch(() => {});
    }
  };

  await tryOrder('T1: ts=ms, side=0, $2',       { tsMs: true,  price: 0.50, size: 4.0,  side: 0 });
  await tryOrder('T2: ts=segundos, side=0, $2',  { tsMs: false, price: 0.50, size: 4.0,  side: 0 });
  await tryOrder('T3: ts=ms, side="BUY", $2',    { tsMs: true,  price: 0.50, size: 4.0,  sideStr: true });
  await tryOrder('T4: negRisk=true, $2',         { tsMs: true,  price: 0.50, size: 4.0,  side: 0, negRisk: true });
  await tryOrder('T5: negRisk=false, $2',        { tsMs: true,  price: 0.50, size: 4.0,  side: 0, negRisk: false });
  await tryOrder('T6: $5 (maior valor)',         { tsMs: true,  price: 0.50, size: 10.0, side: 0 });
}

main().catch(console.error);
