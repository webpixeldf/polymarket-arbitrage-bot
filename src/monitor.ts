import { getBestAsk } from './api';
import { PriceSnapshot } from './models';
import { config } from './config';
import { updatePrice } from './store';

export class MarketMonitor {
  private history: Record<string, PriceSnapshot[]> = {};
  private upTokenId: string;
  private asset: string;

  constructor(tokenIds: string[], asset: string) {
    this.upTokenId = tokenIds[0];
    this.asset = asset;
    for (const id of tokenIds) {
      this.history[id] = [];
    }
  }

  async poll(tokenId: string): Promise<number | null> {
    const ask = await getBestAsk(tokenId);
    if (ask !== null) {
      this.history[tokenId].push({ timestamp: Date.now(), ask });
      const cutoff = Date.now() - 30 * 60 * 1000;
      this.history[tokenId] = this.history[tokenId].filter(s => s.timestamp >= cutoff);
      const side = tokenId === this.upTokenId ? 'up' : 'down';
      updatePrice(this.asset, side, ask);
    }
    return ask;
  }

  getHistory(tokenId: string): PriceSnapshot[] {
    return this.history[tokenId] ?? [];
  }

  detectDump(tokenId: string, currentAsk: number): boolean {
    const windowMs = config.dumpHedgeWindowMinutes * 60 * 1000;
    const cutoff = Date.now() - windowMs;
    const recent = this.history[tokenId].filter(s => s.timestamp >= cutoff);
    if (recent.length === 0) return false;
    const highest = Math.max(...recent.map(s => s.ask));
    const drop = (highest - currentAsk) / highest;
    return drop >= config.dumpHedgeMoveThreshold;
  }
}
