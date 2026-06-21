import { ClobClient } from '@polymarket/clob-client';
import { buyShares, redeemWinnings } from './api';
import { MarketMonitor } from './monitor';
import { appendHistory } from './logger';
import { notifyOpportunity } from './notifier';
import { config } from './config';
import { LegState, GammaMarket } from './models';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function runDumpHedgeCycle(
  client: ClobClient,
  market: GammaMarket,
  asset: string,
  simulate: boolean
): Promise<void> {
  const tokenIds: string[] = JSON.parse(market.clobTokenIds);
  const [upTokenId, downTokenId] = tokenIds; // index 0 = Up, index 1 = Down

  const monitor = new MarketMonitor([upTokenId, downTokenId]);

  const leg1: LegState = { filled: false, tokenId: '', entryPrice: null, orderId: null };
  const leg2: LegState = { filled: false, tokenId: '', entryPrice: null, orderId: null };

  const startTime = Date.now();
  const windowMs = config.dumpHedgeWindowMinutes * 60 * 1000;
  const stopLossMs = config.dumpHedgeStopLossMaxWaitMinutes * 60 * 1000;
  const roundEndMs = new Date(market.endDate).getTime();

  console.error(`[${asset.toUpperCase()}] Round started — ends ${market.endDateIso}`);

  while (Date.now() < roundEndMs) {
    const elapsed = Date.now() - startTime;

    const [upAsk, downAsk] = await Promise.all([
      monitor.poll(upTokenId),
      monitor.poll(downTokenId),
    ]);

    if (upAsk === null || downAsk === null) {
      await sleep(config.checkIntervalMs);
      continue;
    }

    // LEG 1: detect dump, buy dumped leg
    if (!leg1.filled && elapsed <= windowMs) {
      const upDumped = monitor.detectDump(upTokenId, upAsk);
      const downDumped = monitor.detectDump(downTokenId, downAsk);

      if (upDumped || downDumped) {
        const dumpedToken = upDumped ? upTokenId : downTokenId;
        const dumpedAsk = upDumped ? upAsk : downAsk;
        const label = upDumped ? 'UP' : 'DOWN';

        console.error(`[${asset.toUpperCase()}] Dump detected on ${label} leg @ ${dumpedAsk.toFixed(4)}`);

        leg1.tokenId = dumpedToken;
        leg1.entryPrice = dumpedAsk;
        leg1.orderId = await buyShares(client, dumpedToken, dumpedAsk, config.dumpHedgeShares, simulate);
        leg1.filled = true;

        console.error(`[${asset.toUpperCase()}][LEG1] Bought dumped leg @ ${dumpedAsk.toFixed(4)}`);
      }
    }

    // LEG 2: hedge when combined cost is favorable or stop-loss triggers
    if (leg1.filled && !leg2.filled) {
      const hedgeToken = leg1.tokenId === upTokenId ? downTokenId : upTokenId;
      const hedgeAsk = leg1.tokenId === upTokenId ? downAsk : upAsk;
      const combinedCost = leg1.entryPrice! + hedgeAsk;

      const profitHedge = combinedCost <= config.dumpHedgeSumTarget;
      const stopLoss = elapsed >= stopLossMs;

      if (profitHedge || stopLoss) {
        const mode = profitHedge ? 'hedge' : 'stop-loss';
        console.error(`[${asset.toUpperCase()}][LEG2:${mode.toUpperCase()}] combined=${combinedCost.toFixed(4)} target=${config.dumpHedgeSumTarget}`);

        leg2.tokenId = hedgeToken;
        leg2.entryPrice = hedgeAsk;
        leg2.orderId = await buyShares(client, hedgeToken, hedgeAsk, config.dumpHedgeShares, simulate);
        leg2.filled = true;

        appendHistory({
          asset,
          roundEnd: market.endDateIso,
          leg1Price: leg1.entryPrice!,
          leg2Price: hedgeAsk,
          combined: combinedCost,
          target: config.dumpHedgeSumTarget,
          mode,
          timestamp: new Date().toISOString(),
        });

        await notifyOpportunity({
          asset,
          leg: leg1.tokenId === upTokenId ? 'UP' : 'DOWN',
          leg1Price: leg1.entryPrice!,
          leg2Price: hedgeAsk,
          combined: combinedCost,
          target: config.dumpHedgeSumTarget,
          mode,
          simulate,
        });

        // Both legs filled — wait for round end
        break;
      }
    }

    await sleep(config.checkIntervalMs);
  }

  console.error(`[${asset.toUpperCase()}] Round ended.`);

  // Redeem in production if we have two filled legs
  if (leg1.filled && leg2.filled && !simulate) {
    // Determine winner after resolution (simplified: try to redeem both, only one pays out)
    await redeemWinnings(client, market.conditionId, upTokenId, simulate);
  }
}
