import axios from 'axios';
import { ethers } from 'ethers';
import { ClobClient, OrderType, Side } from '@polymarket/clob-client';
import { config } from './config';
import { GammaMarket, OrderBook } from './models';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { buildPolyHmacSignature } = require('@polymarket/clob-client/dist/signing/hmac');

/**
 * Envia ordem no formato v5 do clob-client (inclui deferExec:false).
 * O servidor exige esse campo desde a migração para v5; sem ele retorna
 * "invalid order version, please use the latest clob-client".
 */
async function postOrderV5(order: any, orderType: 'FOK' | 'GTC'): Promise<any> {
  const sideStr = (order.side === 0) ? 'BUY' : 'SELL';
  const payload = {
    deferExec: false,
    order: {
      salt:          parseInt(order.salt, 10),
      maker:         order.maker,
      signer:        order.signer,
      taker:         order.taker,
      tokenId:       order.tokenId,
      makerAmount:   order.makerAmount,
      takerAmount:   order.takerAmount,
      side:          sideStr,
      expiration:    order.expiration,
      nonce:         order.nonce,
      feeRateBps:    order.feeRateBps,
      signatureType: order.signatureType,
      signature:     order.signature,
    },
    owner:     config.apiKey,
    orderType,
  };
  const ts   = Math.floor(Date.now() / 1000);
  const body = JSON.stringify(payload);
  const sig  = buildPolyHmacSignature(config.apiSecret, ts, 'POST', '/order', body);
  try {
    const resp = await axios.post(`${config.clobApiUrl}/order`, payload, {
      headers: {
        POLY_ADDRESS:    order.signer,
        POLY_SIGNATURE:  sig,
        POLY_TIMESTAMP:  `${ts}`,
        POLY_API_KEY:    config.apiKey,
        POLY_PASSPHRASE: config.apiPassphrase,
        'Content-Type':  'application/json',
      },
      timeout: 10_000,
    });
    return resp.data;
  } catch (err: any) {
    // Axios joga exceção em 4xx/5xx — retorna o body para ser logado pelo chamador
    if (err.response?.data) {
      console.error(`[API] POST /order ${err.response.status}: ${JSON.stringify(err.response.data)}`);
      console.error(`[API] Payload enviado: ${body.slice(0, 300)}`);
      return err.response.data;
    }
    throw err;
  }
}

export function createClobClient(): ClobClient {
  const wallet = new ethers.Wallet(config.privateKey);
  const creds = (config.apiKey && config.apiSecret && config.apiPassphrase)
    ? { key: config.apiKey, secret: config.apiSecret, passphrase: config.apiPassphrase }
    : undefined;
  return new ClobClient(
    config.clobApiUrl,
    137,
    wallet,
    creds as any,
    config.signatureType,
    config.proxyWalletAddress
  );
}

export async function findActive15mMarket(asset: string): Promise<GammaMarket | null> {
  try {
    // Slug pattern: btc-updown-15m-*, eth-updown-15m-*, etc.
    const slugPattern = `${asset.toLowerCase()}-updown-15m`;
    const resp = await axios.get(`${config.gammaApiUrl}/markets`, {
      params: { active: true, limit: 500, order: 'createdAt', ascending: false },
      timeout: 15000,
    });
    const markets = resp.data as any[];
    if (!markets || markets.length === 0) return null;

    const now = Date.now();
    const valid = markets.filter(m =>
      m.slug && m.slug.includes(slugPattern) &&
      m.clobTokenIds && m.endDate &&
      new Date(m.endDate).getTime() > now + 2 * 60 * 1000
    );

    if (valid.length === 0) {
      console.error(`[API] No active 15m market found for ${asset}`);
      return null;
    }

    valid.sort((a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime());
    return valid[0] as GammaMarket;
  } catch (err) {
    console.error(`[API] Failed to fetch market for ${asset}:`, (err as Error).message);
    return null;
  }
}

export async function getBestAsk(tokenId: string): Promise<number | null> {
  try {
    const resp = await axios.get<OrderBook>(`${config.clobApiUrl}/book`, {
      params: { token_id: tokenId },
      timeout: 5000,
    });
    const asks = resp.data.asks ?? [];
    if (asks.length === 0) return null;
    return Math.min(...asks.map(a => parseFloat(a.price)));
  } catch {
    return null;
  }
}

export interface OrderBookData {
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
  liquidityAtAsk: number;  // USDC disponível no melhor ask (shares × price)
  totalBidSize: number;
  totalAskSize: number;
  askLevels: number;       // níveis de preço distintos no ask
  bidLevels: number;
}

export async function getOrderBookData(tokenId: string): Promise<OrderBookData> {
  const empty: OrderBookData = { bestBid: null, bestAsk: null, spread: null, liquidityAtAsk: 0, totalBidSize: 0, totalAskSize: 0, askLevels: 0, bidLevels: 0 };
  try {
    const resp = await axios.get<OrderBook>(`${config.clobApiUrl}/book`, {
      params: { token_id: tokenId },
      timeout: 5000,
    });
    const bids = resp.data.bids ?? [];
    const asks = resp.data.asks ?? [];
    if (!asks.length && !bids.length) return empty;

    const bestAsk = asks.length ? Math.min(...asks.map(a => parseFloat(a.price))) : null;
    const bestBid = bids.length ? Math.max(...bids.map(b => parseFloat(b.price))) : null;
    const spread  = (bestAsk !== null && bestBid !== null) ? bestAsk - bestBid : null;

    // Liquidez no melhor ask em USDC (shares disponíveis × preço)
    const liquidityAtAsk = bestAsk !== null
      ? asks.filter(a => Math.abs(parseFloat(a.price) - bestAsk) < 0.001)
            .reduce((s, a) => s + parseFloat(a.size) * bestAsk, 0)
      : 0;

    const totalBidSize = bids.reduce((s, b) => s + parseFloat(b.size), 0);
    const totalAskSize = asks.reduce((s, a) => s + parseFloat(a.size), 0);
    const askLevels    = new Set(asks.map(a => a.price)).size;
    const bidLevels    = new Set(bids.map(b => b.price)).size;

    return { bestBid, bestAsk, spread, liquidityAtAsk, totalBidSize, totalAskSize, askLevels, bidLevels };
  } catch {
    return empty;
  }
}

export async function sellShares(
  client: ClobClient,
  tokenId: string,
  price: number,
  shares: number,
  simulate: boolean
): Promise<string | null> {
  if (simulate) {
    console.error(`[SIM] SELL ${shares} shares @ ${price.toFixed(4)} token=${tokenId}`);
    return 'sim-order-id';
  }
  try {
    let negRisk = false, feeRateBps = 0;
    try {
      const [nr, fee] = await Promise.all([
        axios.get(`${config.clobApiUrl}/neg-risk`, { params: { token_id: tokenId }, timeout: 5000 }),
        axios.get(`${config.clobApiUrl}/fee-rate`, { params: { token_id: tokenId }, timeout: 5000 }),
      ]);
      negRisk    = nr.data?.neg_risk  === true;
      feeRateBps = fee.data?.base_fee ?? 0;
    } catch { /* mantém defaults */ }
    const order = await client.createOrder({ tokenID: tokenId, price, size: shares, side: Side.SELL, feeRateBps }, { negRisk });
    const resp  = await postOrderV5(order, 'FOK');
    console.error(`[API] SELL resp: ${JSON.stringify(resp)}`);
    return (resp as any).orderID ?? null;
  } catch (err) {
    console.error(`[API] Sell order failed:`, (err as Error).message);
    return null;
  }
}

export async function buyShares(
  client: ClobClient,
  tokenId: string,
  price: number,
  shares: number,
  simulate: boolean,
  slippage: number = 0,
  orderType: OrderType = OrderType.FOK
): Promise<string | null> {
  if (simulate) {
    console.error(`[SIM] BUY ${shares.toFixed(2)} shares @ ${price.toFixed(4)} token=${tokenId}`);
    return 'sim-order-id';
  }
  try {
    const limitPrice = parseFloat(Math.min(price + slippage, 0.99).toFixed(4));
    // Busca negRisk e feeRateBps reais do mercado (ambos afetam a assinatura EIP-712)
    let negRisk = false;
    let feeRateBps = 0;
    try {
      const [nr, fee] = await Promise.all([
        axios.get(`${config.clobApiUrl}/neg-risk`,  { params: { token_id: tokenId }, timeout: 5000 }),
        axios.get(`${config.clobApiUrl}/fee-rate`,  { params: { token_id: tokenId }, timeout: 5000 }),
      ]);
      negRisk    = nr.data?.neg_risk  === true;
      feeRateBps = fee.data?.base_fee ?? 0;
    } catch { /* mantém defaults */ }

    // v4.0.0 API: createOrder (limite) + postOrder (FOK ou GTC)
    const order = await client.createOrder({
      tokenID    : tokenId,
      price      : limitPrice,
      size       : parseFloat(shares.toFixed(6)),
      side       : Side.BUY,
      feeRateBps,           // taxa real do mercado na assinatura EIP-712
    }, { negRisk });
    const postType = (orderType === OrderType.GTC || orderType === OrderType.GTD)
      ? OrderType.GTC
      : OrderType.FOK;
    console.error(`[API] ORDER negRisk=${negRisk} fee=${feeRateBps} sigType=${(order as any).signatureType} maker=${((order as any).maker||'').slice(0,10)}...`);
    const resp = await postOrderV5(order, postType === OrderType.GTC ? 'GTC' : 'FOK');
    console.error(`[API] ${postType} resp: ${JSON.stringify(resp)}`);
    return (resp as any).orderID ?? (resp as any).order?.id ?? null;
  } catch (err) {
    console.error(`[API] Order failed (${orderType}):`, (err as Error).message);
    return null;
  }
}

// Polymarket crypto rounds end on exact minute boundaries in ET (UTC-4 in summer)
export function nextRoundEndMs(roundMinutes: number): number {
  const ET_OFFSET_MS = 4 * 60 * 60 * 1000; // ET = UTC-4
  const nowET = Date.now() - ET_OFFSET_MS;
  const roundMs = roundMinutes * 60 * 1000;
  const elapsed = nowET % roundMs;
  return Date.now() + (roundMs - elapsed);
}

export async function getWalletBalance(client: ClobClient): Promise<number | null> {
  try {
    const resp = await client.getBalanceAllowance({ asset_type: 'USDC' } as any);
    const raw = (resp as any)?.balance ?? (resp as any)?.collateral ?? resp;
    const num = parseFloat(String(raw));
    return isNaN(num) ? null : num;
  } catch {
    return null;
  }
}

export async function redeemWinnings(
  client: ClobClient,
  conditionId: string,
  winningTokenId: string,
  simulate: boolean
): Promise<void> {
  if (simulate) {
    console.error(`[SIM] Would redeem winning token ${winningTokenId}`);
    return;
  }
  try {
    await (client as any).redeemPositions({
      conditionId,
      amounts: [{ tokenId: winningTokenId, amount: config.dumpHedgeShares }],
    });
    console.error(`[SETTLE] Redeemed ${config.dumpHedgeShares} shares for ${winningTokenId}`);
  } catch (err) {
    console.error(`[SETTLE] Redemption failed:`, (err as Error).message);
  }
}
