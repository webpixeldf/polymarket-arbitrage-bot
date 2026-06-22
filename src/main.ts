import { config } from './config';
import { createClobClient, getWalletBalance } from './api';
import { log } from './logger';
import { startDashboard } from './dashboard';
import { store } from './store';
import { startConvergenceScalper } from './convergenceScalper';
import { sendStartupEmail } from './notifier';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const isProduction =
  process.argv.includes('--production') || config.production;

const isSimulation =
  process.argv.includes('--simulation') || !isProduction;

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
  store.simulate = isSimulation;
  startDashboard();
  log('INFO', `Bot starting in ${mode} mode`);

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
    startConvergenceScalper(isSimulation),
    watchWalletBalance(),
  ]);
}

main().catch(err => {
  log('ERROR', 'Fatal error', { error: err.message });
  process.exit(1);
});
