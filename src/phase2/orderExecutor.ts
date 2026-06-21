import { ethers } from 'ethers';
import { ClobClient, OrderType, Side } from '@polymarket/clob-client';
import { getBestAsk, buyShares } from '../api';
import { config } from '../config';
import { ValueBet } from './valueBetDetector';

const MAX_BET_USDC = parseFloat(process.env.MAX_BET_USDC ?? '5');
const ORDERS_ENABLED = process.env.ENABLE_PHASE2_ORDERS === 'true';

export interface ExecutionResult {
  orderId: string | null;
  tokenId: string;
  side: 'YES' | 'NO';
  price: number;
  amountUsdc: number;
  error?: string;
}

// Cached authenticated client — derived once per process
let authClient: ClobClient | null = null;

async function getAuthenticatedClient(): Promise<ClobClient | null> {
  if (authClient) return authClient;

  if (!config.privateKey || !config.proxyWalletAddress) {
    console.error('[Executor] Missing PRIVATE_KEY or PROXY_WALLET_ADDRESS');
    return null;
  }

  try {
    const wallet = new ethers.Wallet(config.privateKey);

    // Base client without creds — used only to derive API key
    const base = new ClobClient(
      config.clobApiUrl,
      137,
      wallet,
      undefined,
      config.signatureType,
      config.proxyWalletAddress
    );

    console.error('[Executor] Deriving API credentials from private key...');
    const creds = await base.createOrDeriveApiKey();
    console.error(`[Executor] API key ready: ${creds.key.slice(0, 8)}...`);

    // Authenticated client with derived creds
    authClient = new ClobClient(
      config.clobApiUrl,
      137,
      wallet,
      creds,
      config.signatureType,
      config.proxyWalletAddress
    );

    return authClient;
  } catch (err) {
    console.error('[Executor] Failed to derive API credentials:', (err as Error).message);
    return null;
  }
}

export async function executeValueBet(vb: ValueBet): Promise<ExecutionResult | null> {
  if (!ORDERS_ENABLED) return null;

  const side = vb.recommendation === 'BUY_YES' ? 'YES' : 'NO';
  const tokenId = side === 'YES' ? vb.market.yesTokenId : vb.market.noTokenId;

  if (!tokenId) {
    console.error(`[Executor] No ${side} token ID for: ${vb.market.question.slice(0, 50)}`);
    return null;
  }

  // Market expired?
  if (new Date(vb.market.endDate).getTime() <= Date.now()) {
    console.error(`[Executor] Market expired: ${vb.market.question.slice(0, 50)}`);
    return null;
  }

  // Get current best ask
  const currentPrice = await getBestAsk(tokenId);
  if (!currentPrice) {
    console.error(`[Executor] No ask price for token ${tokenId}`);
    return null;
  }

  // Skip if price moved >5% since scan
  const scannedPrice = side === 'YES'
    ? vb.market.probability / 100
    : (100 - vb.market.probability) / 100;

  if (Math.abs(currentPrice - scannedPrice) > 0.05) {
    console.error(`[Executor] Price moved too much: scanned=${scannedPrice.toFixed(2)} current=${currentPrice.toFixed(2)} — skipping`);
    return null;
  }

  const client = await getAuthenticatedClient();
  if (!client) return null;

  console.error(`[Executor] BUY ${side} — $${MAX_BET_USDC} @ ${(currentPrice * 100).toFixed(1)}¢ — ${vb.market.question.slice(0, 50)}`);

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
