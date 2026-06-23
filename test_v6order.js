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

  const TOKEN = '46788745865873849751895851580006231458025441200398102606849707486161173481896';

  console.log('\n=== GTC BUY (novo esquema signatureType=3) ===');
  const result = await postOrderNew({
    wallet, creds, proxyWallet: proxy,
    tokenID: TOKEN,
    price: 0.50, size: 1.0,
    buyOrSell: 'BUY', orderType: 'GTC',
  });

  console.log('\nResultado:', JSON.stringify(result, null, 2));

  if (!result?.error) {
    console.log('\n✅ ORDEM ACEITA! Cancelando...');
    const bodyStr = JSON.stringify({ orderID: result.orderID || result.order?.id });
    const headers = await buildL2Headers(creds, 'DELETE', '/order', bodyStr);
    const cancel = await axios.delete(`https://clob.polymarket.com/order`, { data: { orderID: result.orderID }, headers }).catch(e => e.response?.data);
    console.log('Cancel:', JSON.stringify(cancel));
  }
}

main().catch(console.error);
