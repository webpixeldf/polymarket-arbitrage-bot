'use strict';
// Bridge CJS → ESM: carrega o clob-client v5 via dynamic import()
// Node.js 12+ suporta import() de dentro de CommonJS sem problema.

let _v5 = null;

async function getV5() {
  if (!_v5) {
    _v5 = await import('clob-v5');
  }
  return _v5;
}

/**
 * Cria e envia uma ordem usando o clob-client v5 nativo.
 * v5 resolve automaticamente: feeRateBps, negRisk, deferExec, User-Agent.
 *
 * @returns objeto com orderID (sucesso) ou error (falha)
 */
async function postOrderNativeV5({ clobUrl, chainId, wallet, creds, signatureType, proxyWallet, tokenID, price, size, buyOrSell, feeRateBps, negRisk, orderType }) {
  const v5 = await getV5();
  const client = new v5.ClobClient(
    clobUrl,
    chainId,
    wallet,
    creds,
    signatureType,
    proxyWallet,
  );
  const side = buyOrSell === 'BUY' ? v5.Side.BUY : v5.Side.SELL;
  const order = await client.createOrder(
    { tokenID, price, size, side, feeRateBps },
    { negRisk },
  );
  const type = orderType === 'GTC' ? v5.OrderType.GTC : v5.OrderType.FOK;
  // deferExec=false é o padrão no v5
  return client.postOrder(order, type, false);
}

module.exports = { postOrderNativeV5 };
