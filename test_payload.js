'use strict';
// Gera o payload exato que o v5 envia para POST /order e imprime como JSON
require('dotenv').config({ override: true });
const { ethers } = require('ethers');

async function main() {
  const v5 = await import('clob-v5');
  const { orderToJson } = await import('clob-v5/dist/utilities.js');

  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY);
  const proxy  = process.env.PROXY_WALLET_ADDRESS;
  const creds  = { key: process.env.API_KEY, secret: process.env.API_SECRET, passphrase: process.env.API_PASSPHRASE };

  const client = new v5.ClobClient('https://clob.polymarket.com', 137, wallet, creds, 1, proxy);
  const TOKEN  = '46788745865873849751895851580006231458025441200398102606849707486161173481896';

  const order = await client.createOrder(
    { tokenID: TOKEN, price: 0.50, size: 1.0, side: v5.Side.BUY },
    { negRisk: true }
  );

  const payload = orderToJson(order, creds.key, v5.OrderType.GTC, false, false);
  // Imprime numa linha (para capturar com $() no bash)
  process.stdout.write(JSON.stringify(payload));
}
main().catch(e => { process.stderr.write(e.message); process.exit(1); });
