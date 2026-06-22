import axios from 'axios';
import { ethers } from 'ethers';
import { ClobClient, OrderType, Side } from '@polymarket/clob-client';
import { config } from './config';
import { GammaMarket, OrderBook } from './models';

export function createClobClient(): ClobClient {
  const wallet = new ethers.Wallet(config.privateKey);
  return new ClobClient(
    config.clobApiUrl,
    137,
    wallet,
    undefined,
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

export async function buyShares(
  client: ClobClient,
  tokenId: string,
  price: number,
  shares: number,
  simulate: boolean
): Promise<string | null> {
  if (simulate) {
    console.error(`[SIM] BUY ${shares} shares @ ${price.toFixed(4)} token=${tokenId}`);
    return 'sim-order-id';
  }
  try {
    // FOK = Fill or Kill (market order — fills immediately or cancels)
    const resp = await client.createAndPostMarketOrder({
      tokenID: tokenId,
      price,
      amount: shares,
      side: Side.BUY,
    }, undefined, OrderType.FOK);
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
