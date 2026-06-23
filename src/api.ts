import axios from 'axios';
import { ethers } from 'ethers';
import { ClobClient, OrderType, Side } from '@polymarket/clob-client';
import { config } from './config';
import { GammaMarket, OrderBook } from './models';

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
    const resp = await client.createAndPostMarketOrder({
      tokenID: tokenId,
      price,
      amount: shares,
      side: Side.SELL,
    }, undefined, OrderType.FOK);
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
  slippage: number = 0   // tolerância máxima acima do preço lido (ex: 0.03 = 3¢)
): Promise<string | null> {
  if (simulate) {
    console.error(`[SIM] BUY ${shares} shares @ ${price.toFixed(4)} token=${tokenId}`);
    return 'sim-order-id';
  }
  try {
    // FOK com slippage: aceita pagar até price+slippage para garantir execução
    const orderPrice = parseFloat(Math.min(price + slippage, 0.99).toFixed(4));
    const resp = await client.createAndPostMarketOrder({
      tokenID: tokenId,
      price  : orderPrice,
      amount : shares,
      side   : Side.BUY,
    }, undefined, OrderType.FOK);
    console.error(`[API] FOK resp: ${JSON.stringify(resp)}`);
    return (resp as any).orderID ?? null;
  } catch (err) {
    console.error(`[API] Order failed:`, (err as Error).message);
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
    const resp = await (client as any).getBalance();
    const raw = resp?.balance ?? resp?.collateral ?? resp;
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
