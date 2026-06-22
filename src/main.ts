import { config } from './config';
import { createClobClient, findActive15mMarket, getWalletBalance } from './api';
import { runDumpHedgeCycle } from './dumpHedgeTrader';
import { log } from './logger';
import { startDashboard } from './dashboard';
import { store } from './store';
import { startLastMinuteScalper } from './lastMinuteScalper';
import { sendStartupEmail } from './notifier';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const isProduction =
  process.argv.includes('--production') || config.production;

const isSimulation =
  process.argv.includes('--simulation') || !isProduction;

async function runAssetMonitor(asset: string): Promise<void> {
  const client = createClobClient();
  log('INFO', `Starting monitor for ${asset.toUpperCase()}`, { simulate: isSimulation });

  while (true) {
    const market = await findActive15mMarket(asset);

    if (!market) {
      log('WARN', `No active 15m market for ${asset}, retrying in 30s`);
      await sleep(30_000);
      continue;
    }

    const roundEnd = new Date(market.endDate).getTime();
    const now = Date.now();

    if (roundEnd - now < 2 * 60 * 1000) {
      log('INFO', `Round for ${asset} ending soon, waiting for next round`);
      const wait = Math.min(Math.max(0, roundEnd - now + 5_000), 5 * 60 * 1000);
      await sleep(wait);
      continue;
    }

    try {
      await runDumpHedgeCycle(client, market, asset, isSimulation);
    } catch (err) {
      log('ERROR', `Cycle error for ${asset}`, { error: (err as Error).message });
    }

    const waitMs = Math.min(Math.max(0, roundEnd - Date.now() + 5_000), 20 * 60 * 1000);
    await sleep(waitMs);
  }
}

async function watchWalletBalance(): Promise<void> {
  const client = createClobClient();
  while (true) {
    const balance = await getWalletBalance(client);
    if (balance !== null) {
      store.walletBalance = balance;
      store.walletUpdatedAt = new Date().toISOString();
    }
    await sleep(120_000);
  }
}

async function main(): Promise<void> {
  const mode = isSimulation ? 'SIMULATION' : 'PRODUCTION';
  store.markets = config.markets;
  store.simulate = isSimulation;
  startDashboard();
  log('INFO', `Bot starting in ${mode} mode`, { markets: config.markets });

  if (isSimulation) {
    console.error('='.repeat(60));
    console.error('  MODO SIMULACAO — nenhuma ordem real sera executada');
    console.error('='.repeat(60));
  } else {
    console.error('='.repeat(60));
    console.error('  MODO PRODUCAO — ordens REAIS serao executadas!');
    console.error(`  Carteira: ${config.proxyWalletAddress}`);
    console.error('='.repeat(60));
  }

  await sendStartupEmail(isSimulation);

  await Promise.all([
    ...config.markets.map(asset => runAssetMonitor(asset)),
    startLastMinuteScalper(isSimulation),
    watchWalletBalance(),
  ]);
}

main().catch(err => {
  log('ERROR', 'Fatal error', { error: err.message });
  process.exit(1);
});
