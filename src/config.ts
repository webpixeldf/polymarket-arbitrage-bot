import * as dotenv from 'dotenv';
dotenv.config({ override: true });

function required(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

export const config = {
  privateKey: process.env.PRIVATE_KEY ?? '',
  proxyWalletAddress: process.env.PROXY_WALLET_ADDRESS ?? '',
  signatureType: parseInt(process.env.SIGNATURE_TYPE ?? '2', 10),

  markets: (process.env.MARKETS ?? 'btc').split(',').map(m => m.trim().toLowerCase()),

  checkIntervalMs: parseInt(process.env.CHECK_INTERVAL_MS ?? '1000', 10),

  dumpHedgeShares: parseFloat(process.env.DUMP_HEDGE_SHARES ?? '10'),
  dumpHedgeSumTarget: parseFloat(process.env.DUMP_HEDGE_SUM_TARGET ?? '0.95'),
  dumpHedgeMoveThreshold: parseFloat(process.env.DUMP_HEDGE_MOVE_THRESHOLD ?? '0.15'),
  dumpHedgeWindowMinutes: parseInt(process.env.DUMP_HEDGE_WINDOW_MINUTES ?? '5', 10),
  dumpHedgeStopLossMaxWaitMinutes: parseInt(
    process.env.DUMP_HEDGE_STOP_LOSS_MAX_WAIT_MINUTES ?? '8', 10
  ),

  production: process.env.PRODUCTION === 'true',

  gammaApiUrl: process.env.GAMMA_API_URL ?? 'https://gamma-api.polymarket.com',
  clobApiUrl: process.env.CLOB_API_URL ?? 'https://clob.polymarket.com',

  apiKey: process.env.API_KEY ?? '',
  apiSecret: process.env.API_SECRET ?? '',
  apiPassphrase: process.env.API_PASSPHRASE ?? '',
};
