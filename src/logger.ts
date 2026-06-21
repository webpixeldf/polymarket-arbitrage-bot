import * as fs from 'fs';
import * as path from 'path';
import { TradeRecord } from './models';

const HISTORY_FILE = path.resolve(process.cwd(), 'history.toml');

export function appendHistory(record: TradeRecord): void {
  const entry = `
[[trade]]
asset = "${record.asset}"
round_end = "${record.roundEnd}"
leg1_price = ${record.leg1Price}
leg2_price = ${record.leg2Price}
combined = ${record.combined}
target = ${record.target}
mode = "${record.mode}"
timestamp = "${record.timestamp}"
`;
  fs.appendFileSync(HISTORY_FILE, entry, 'utf8');
}

export function log(level: 'INFO' | 'WARN' | 'ERROR', message: string, data?: object): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(data ?? {}),
  };
  console.error(JSON.stringify(entry));
}
