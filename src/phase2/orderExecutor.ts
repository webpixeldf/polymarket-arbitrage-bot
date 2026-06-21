import { createClobClient, getBestAsk, buyShares } from '../api';
import { ValueBet } from './valueBetDetector';

// Maximum USDC to spend per value bet (set MAX_BET_USDC in Railway env)
const MAX_BET_USDC = parseFloat(process.env.MAX_BET_USDC ?? '5');

// Only execute if explicitly enabled AND not in simulation
const ORDERS_ENABLED = process.env.ENABLE_PHASE2_ORDERS === 'true';

export interface ExecutionResult {
  orderId: string | null;
  tokenId: string;
  side: 'YES' | 'NO';
  price: number;
  amountUsdc: number;
  error?: string;
}

export async function executeValueBet(vb: ValueBet): Promise<ExecutionResult | null> {
  if (!ORDERS_ENABLED) {
    console.error('[Executor] ENABLE_PHASE2_ORDERS not set — skipping real order.');
    return null;
  }

  if (!process.env.PRIVATE_KEY || !process.env.PROXY_WALLET_ADDRESS) {
    console.error('[Executor] Missing PRIVATE_KEY or PROXY_WALLET_ADDRESS — cannot execute.');
    return null;
  }

  const side = vb.recommendation === 'BUY_YES' ? 'YES' : 'NO';
  const tokenId = side === 'YES' ? vb.market.yesTokenId : vb.market.noTokenId;

  if (!tokenId) {
    console.error(`[Executor] No ${side} token ID for: ${vb.market.question.slice(0, 50)}`);
    return null;
  }

  // Check market hasn't expired
  const daysLeft = (new Date(vb.market.endDate).getTime() - Date.now()) / 86400000;
  if (daysLeft <= 0) {
    console.error(`[Executor] Market expired: ${vb.market.question.slice(0, 50)}`);
    return null;
  }

  // Get current best ask to confirm price is still valid
  const currentPrice = await getBestAsk(tokenId);
  if (!currentPrice) {
    console.error(`[Executor] Could not get ask price for ${tokenId}`);
    return null;
  }

  // Sanity check: if price moved more than 5% since scan, skip
  const scannedPrice = side === 'YES'
    ? vb.market.probability / 100
    : (100 - vb.market.probability) / 100;

  if (Math.abs(currentPrice - scannedPrice) > 0.05) {
    console.error(`[Executor] Price moved too much: scanned=${scannedPrice.toFixed(2)} current=${currentPrice.toFixed(2)} — skipping`);
    return null;
  }

  const client = createClobClient();

  console.error(`[Executor] [REAL] BUY ${side} — $${MAX_BET_USDC} @ ${(currentPrice * 100).toFixed(1)}¢ — ${vb.market.question.slice(0, 50)}`);

  // ENABLE_PHASE2_ORDERS=true overrides global simulation mode — always place real orders
  const orderId = await buyShares(client, tokenId, currentPrice, MAX_BET_USDC, false);

  return {
    orderId,
    tokenId,
    side,
    price: currentPrice,
    amountUsdc: MAX_BET_USDC,
    error: orderId ? undefined : 'Order failed — check logs',
  };
}
