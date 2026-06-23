/**
 * Weather Scanner — Estratégia ColdMath
 * Verifica temperatura real via Open-Meteo e compra o resultado correto
 * quando o mercado Polymarket ainda está precificado abaixo de 20¢
 */
import axios from 'axios';
import { config } from './config';
import { buyShares, createClobClient, getOrderBookData } from './api';
import { notify } from './notifier';

// ── Config ─────────────────────────────────────────────────────────────────
const BET_USDC      = parseFloat(process.env.WEATHER_BET_USDC  ?? '5');
const MAX_ENTRY     = parseFloat(process.env.WEATHER_MAX_ENTRY ?? '0.20');
const SCAN_SECS     = parseInt (process.env.WEATHER_SCAN_SECS  ?? '120');
const SCAN_INTERVAL = SCAN_SECS * 1_000;

// ── Banco de cidades (lat, lon, timezone IANA) ──────────────────────────────
type CityData = { lat: number; lon: number; tz: string };
const CITIES: Record<string, CityData> = {
  'paris':              { lat: 48.8566,  lon:   2.3522,  tz: 'Europe/Paris'          },
  'london':             { lat: 51.5074,  lon:  -0.1278,  tz: 'Europe/London'         },
  'berlin':             { lat: 52.5200,  lon:  13.4050,  tz: 'Europe/Berlin'         },
  'madrid':             { lat: 40.4168,  lon:  -3.7038,  tz: 'Europe/Madrid'         },
  'barcelona':          { lat: 41.3851,  lon:   2.1734,  tz: 'Europe/Madrid'         },
  'rome':               { lat: 41.9028,  lon:  12.4964,  tz: 'Europe/Rome'           },
  'milan':              { lat: 45.4654,  lon:   9.1859,  tz: 'Europe/Rome'           },
  'amsterdam':          { lat: 52.3676,  lon:   4.9041,  tz: 'Europe/Amsterdam'      },
  'brussels':           { lat: 50.8503,  lon:   4.3517,  tz: 'Europe/Brussels'       },
  'vienna':             { lat: 48.2082,  lon:  16.3738,  tz: 'Europe/Vienna'         },
  'zurich':             { lat: 47.3769,  lon:   8.5417,  tz: 'Europe/Zurich'         },
  'stockholm':          { lat: 59.3293,  lon:  18.0686,  tz: 'Europe/Stockholm'      },
  'oslo':               { lat: 59.9139,  lon:  10.7522,  tz: 'Europe/Oslo'           },
  'copenhagen':         { lat: 55.6761,  lon:  12.5683,  tz: 'Europe/Copenhagen'     },
  'helsinki':           { lat: 60.1699,  lon:  24.9384,  tz: 'Europe/Helsinki'       },
  'lisbon':             { lat: 38.7223,  lon:  -9.1393,  tz: 'Europe/Lisbon'         },
  'athens':             { lat: 37.9838,  lon:  23.7275,  tz: 'Europe/Athens'         },
  'warsaw':             { lat: 52.2297,  lon:  21.0122,  tz: 'Europe/Warsaw'         },
  'prague':             { lat: 50.0755,  lon:  14.4378,  tz: 'Europe/Prague'         },
  'budapest':           { lat: 47.4979,  lon:  19.0402,  tz: 'Europe/Budapest'       },
  'bucharest':          { lat: 44.4268,  lon:  26.1025,  tz: 'Europe/Bucharest'      },
  'istanbul':           { lat: 41.0082,  lon:  28.9784,  tz: 'Europe/Istanbul'       },
  'ankara':             { lat: 39.9334,  lon:  32.8597,  tz: 'Europe/Istanbul'       },
  'moscow':             { lat: 55.7558,  lon:  37.6176,  tz: 'Europe/Moscow'         },
  'kyiv':               { lat: 50.4501,  lon:  30.5234,  tz: 'Europe/Kiev'           },
  'new york city':      { lat: 40.7128,  lon: -74.0060,  tz: 'America/New_York'      },
  'new york':           { lat: 40.7128,  lon: -74.0060,  tz: 'America/New_York'      },
  'chicago':            { lat: 41.8781,  lon: -87.6298,  tz: 'America/Chicago'       },
  'dallas':             { lat: 32.7767,  lon: -96.7970,  tz: 'America/Chicago'       },
  'houston':            { lat: 29.7604,  lon: -95.3698,  tz: 'America/Chicago'       },
  'minneapolis':        { lat: 44.9778,  lon: -93.2650,  tz: 'America/Chicago'       },
  'detroit':            { lat: 42.3314,  lon: -83.0458,  tz: 'America/Detroit'       },
  'atlanta':            { lat: 33.7490,  lon: -84.3880,  tz: 'America/New_York'      },
  'miami':              { lat: 25.7617,  lon: -80.1918,  tz: 'America/New_York'      },
  'boston':             { lat: 42.3601,  lon: -71.0589,  tz: 'America/New_York'      },
  'philadelphia':       { lat: 39.9526,  lon: -75.1652,  tz: 'America/New_York'      },
  'washington':         { lat: 38.9072,  lon: -77.0369,  tz: 'America/New_York'      },
  'washington dc':      { lat: 38.9072,  lon: -77.0369,  tz: 'America/New_York'      },
  'denver':             { lat: 39.7392,  lon:-104.9903,  tz: 'America/Denver'        },
  'phoenix':            { lat: 33.4484,  lon:-112.0740,  tz: 'America/Phoenix'       },
  'las vegas':          { lat: 36.1699,  lon:-115.1398,  tz: 'America/Los_Angeles'   },
  'los angeles':        { lat: 34.0522,  lon:-118.2437,  tz: 'America/Los_Angeles'   },
  'san francisco':      { lat: 37.7749,  lon:-122.4194,  tz: 'America/Los_Angeles'   },
  'seattle':            { lat: 47.6062,  lon:-122.3321,  tz: 'America/Los_Angeles'   },
  'portland':           { lat: 45.5051,  lon:-122.6750,  tz: 'America/Los_Angeles'   },
  'toronto':            { lat: 43.6532,  lon: -79.3832,  tz: 'America/Toronto'       },
  'montreal':           { lat: 45.5017,  lon: -73.5673,  tz: 'America/Toronto'       },
  'vancouver':          { lat: 49.2827,  lon:-123.1207,  tz: 'America/Vancouver'     },
  'calgary':            { lat: 51.0447,  lon:-114.0719,  tz: 'America/Edmonton'      },
  'sao paulo':          { lat:-23.5505,  lon: -46.6333,  tz: 'America/Sao_Paulo'     },
  'rio de janeiro':     { lat:-22.9068,  lon: -43.1729,  tz: 'America/Sao_Paulo'     },
  'bogota':             { lat:  4.7110,  lon: -74.0721,  tz: 'America/Bogota'        },
  'lima':               { lat:-12.0464,  lon: -77.0428,  tz: 'America/Lima'          },
  'santiago':           { lat:-33.4489,  lon: -70.6693,  tz: 'America/Santiago'      },
  'buenos aires':       { lat:-34.6037,  lon: -58.3816,  tz: 'America/Argentina/Buenos_Aires' },
  'mexico city':        { lat: 19.4326,  lon: -99.1332,  tz: 'America/Mexico_City'   },
  'tokyo':              { lat: 35.6762,  lon: 139.6503,  tz: 'Asia/Tokyo'            },
  'osaka':              { lat: 34.6937,  lon: 135.5023,  tz: 'Asia/Tokyo'            },
  'seoul':              { lat: 37.5665,  lon: 126.9780,  tz: 'Asia/Seoul'            },
  'busan':              { lat: 35.1796,  lon: 129.0756,  tz: 'Asia/Seoul'            },
  'beijing':            { lat: 39.9042,  lon: 116.4074,  tz: 'Asia/Shanghai'         },
  'shanghai':           { lat: 31.2304,  lon: 121.4737,  tz: 'Asia/Shanghai'         },
  'chongqing':          { lat: 29.5630,  lon: 106.5516,  tz: 'Asia/Shanghai'         },
  'hong kong':          { lat: 22.3193,  lon: 114.1694,  tz: 'Asia/Hong_Kong'        },
  'taipei':             { lat: 25.0330,  lon: 121.5654,  tz: 'Asia/Taipei'           },
  'singapore':          { lat:  1.3521,  lon: 103.8198,  tz: 'Asia/Singapore'        },
  'jakarta':            { lat: -6.2088,  lon: 106.8456,  tz: 'Asia/Jakarta'          },
  'kuala lumpur':       { lat:  3.1390,  lon: 101.6869,  tz: 'Asia/Kuala_Lumpur'    },
  'manila':             { lat: 14.5995,  lon: 120.9842,  tz: 'Asia/Manila'           },
  'bangkok':            { lat: 13.7563,  lon: 100.5018,  tz: 'Asia/Bangkok'          },
  'hanoi':              { lat: 21.0285,  lon: 105.8542,  tz: 'Asia/Bangkok'          },
  'ho chi minh city':   { lat: 10.8231,  lon: 106.6297,  tz: 'Asia/Ho_Chi_Minh'     },
  'phnom penh':         { lat: 11.5564,  lon: 104.9282,  tz: 'Asia/Phnom_Penh'      },
  'mumbai':             { lat: 19.0760,  lon:  72.8777,  tz: 'Asia/Kolkata'          },
  'delhi':              { lat: 28.6139,  lon:  77.2090,  tz: 'Asia/Kolkata'          },
  'new delhi':          { lat: 28.6139,  lon:  77.2090,  tz: 'Asia/Kolkata'          },
  'lucknow':            { lat: 26.8467,  lon:  80.9462,  tz: 'Asia/Kolkata'          },
  'kolkata':            { lat: 22.5726,  lon:  88.3639,  tz: 'Asia/Kolkata'          },
  'chennai':            { lat: 13.0827,  lon:  80.2707,  tz: 'Asia/Kolkata'          },
  'hyderabad':          { lat: 17.3850,  lon:  78.4867,  tz: 'Asia/Kolkata'          },
  'bangalore':          { lat: 12.9716,  lon:  77.5946,  tz: 'Asia/Kolkata'          },
  'karachi':            { lat: 24.8607,  lon:  67.0011,  tz: 'Asia/Karachi'          },
  'lahore':             { lat: 31.5204,  lon:  74.3587,  tz: 'Asia/Karachi'          },
  'dhaka':              { lat: 23.8103,  lon:  90.4125,  tz: 'Asia/Dhaka'            },
  'kathmandu':          { lat: 27.7172,  lon:  85.3240,  tz: 'Asia/Kathmandu'        },
  'colombo':            { lat:  6.9271,  lon:  79.8612,  tz: 'Asia/Colombo'          },
  'yangon':             { lat: 16.8661,  lon:  96.1951,  tz: 'Asia/Rangoon'          },
  'tehran':             { lat: 35.6892,  lon:  51.3890,  tz: 'Asia/Tehran'           },
  'dubai':              { lat: 25.2048,  lon:  55.2708,  tz: 'Asia/Dubai'            },
  'riyadh':             { lat: 24.7136,  lon:  46.6753,  tz: 'Asia/Riyadh'           },
  'tashkent':           { lat: 41.2995,  lon:  69.2401,  tz: 'Asia/Tashkent'        },
  'almaty':             { lat: 43.2551,  lon:  76.9126,  tz: 'Asia/Almaty'           },
  'baku':               { lat: 40.4093,  lon:  49.8671,  tz: 'Asia/Baku'             },
  'tbilisi':            { lat: 41.6938,  lon:  44.8015,  tz: 'Asia/Tbilisi'          },
  'ulaanbaatar':        { lat: 47.8864,  lon: 106.9057,  tz: 'Asia/Ulaanbaatar'     },
  'sydney':             { lat:-33.8688,  lon: 151.2093,  tz: 'Australia/Sydney'      },
  'melbourne':          { lat:-37.8136,  lon: 144.9631,  tz: 'Australia/Melbourne'   },
  'brisbane':           { lat:-27.4698,  lon: 153.0251,  tz: 'Australia/Brisbane'    },
  'perth':              { lat:-31.9505,  lon: 115.8605,  tz: 'Australia/Perth'       },
  'auckland':           { lat:-36.8509,  lon: 174.7645,  tz: 'Pacific/Auckland'      },
  'wellington':         { lat:-41.2865,  lon: 174.7762,  tz: 'Pacific/Auckland'      },
  'cairo':              { lat: 30.0444,  lon:  31.2357,  tz: 'Africa/Cairo'          },
  'casablanca':         { lat: 33.5731,  lon:  -7.5898,  tz: 'Africa/Casablanca'     },
  'algiers':            { lat: 36.7372,  lon:   3.0863,  tz: 'Africa/Algiers'        },
  'tunis':              { lat: 36.8065,  lon:  10.1815,  tz: 'Africa/Tunis'          },
  'lagos':              { lat:  6.5244,  lon:   3.3792,  tz: 'Africa/Lagos'          },
  'nairobi':            { lat: -1.2921,  lon:  36.8219,  tz: 'Africa/Nairobi'        },
  'addis ababa':        { lat:  8.9806,  lon:  38.7578,  tz: 'Africa/Addis_Ababa'   },
  'johannesburg':       { lat:-26.2041,  lon:  28.0473,  tz: 'Africa/Johannesburg'   },
  'cape town':          { lat:-33.9249,  lon:  18.4241,  tz: 'Africa/Johannesburg'   },
  'dar es salaam':      { lat: -6.7924,  lon:  39.2083,  tz: 'Africa/Dar_es_Salaam' },
  'kinshasa':           { lat: -4.3217,  lon:  15.3226,  tz: 'Africa/Kinshasa'       },
  'accra':              { lat:  5.6037,  lon:  -0.1870,  tz: 'Africa/Accra'          },
};

// ── Parsear questão ─────────────────────────────────────────────────────────
const MONTH_MAP: Record<string, number> = {
  january:1, february:2, march:3, april:4, may:5, june:6,
  july:7, august:8, september:9, october:10, november:11, december:12,
};

interface WeatherCond {
  cityKey : string;
  tempType: 'max' | 'min';
  unit    : 'C' | 'F';
  cond    : 'gte' | 'lte' | 'eq' | 'between';
  val     : number;
  val2?   : number;
  date    : string; // YYYY-MM-DD
}

function resolveYear(monthNum: number, day: number, endDate: string): number {
  const ed = new Date(endDate);
  const ey = ed.getFullYear();
  const em = ed.getMonth() + 1;
  // if the event month is much earlier than endDate month, could be same year
  // if endDate is December and event is in January, might be next year — use endDate year
  if (Math.abs(monthNum - em) <= 2) return ey;
  if (monthNum > em + 2) return ey - 1; // event was last year
  return ey;
}

function parseQuestion(q: string, endDate: string): WeatherCond | null {
  const ql = q.toLowerCase();
  if (!ql.includes('temperature')) return null;

  const tempType: 'max' | 'min' = ql.includes('lowest') || ql.includes('minimum') ? 'min' : 'max';

  // city: "temperature in CITY be"
  const cityRaw = ql.match(/temperature in (.+?) be/)?.[1]?.trim() ?? '';
  if (!cityRaw || !CITIES[cityRaw]) return null;

  // date: "on Month Day"
  const dateRaw = ql.match(/on ([a-z]+ \d{1,2})\b/i)?.[1];
  if (!dateRaw) return null;
  const dm = dateRaw.match(/([a-z]+)\s+(\d{1,2})/i);
  if (!dm) return null;
  const monthNum = MONTH_MAP[dm[1].toLowerCase()];
  const day = parseInt(dm[2]);
  if (!monthNum || !day) return null;
  const year = resolveYear(monthNum, day, endDate);
  const date = `${year}-${String(monthNum).padStart(2,'0')}-${String(day).padStart(2,'0')}`;

  // unit
  const unit: 'C' | 'F' = /\d+°f\b/i.test(ql) ? 'F' : 'C';

  // between X-Y
  const bm = ql.match(/between (\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)°[cf]/);
  if (bm) return { cityKey: cityRaw, tempType, unit, cond: 'between', val: parseFloat(bm[1]), val2: parseFloat(bm[2]), date };

  // gte: X or higher/above
  const gm = ql.match(/(\d+(?:\.\d+)?)°[cf] or (?:higher|above)/);
  if (gm) return { cityKey: cityRaw, tempType, unit, cond: 'gte', val: parseFloat(gm[1]), date };

  // lte: X or lower/below
  const lm = ql.match(/(\d+(?:\.\d+)?)°[cf] or (?:lower|below)/);
  if (lm) return { cityKey: cityRaw, tempType, unit, cond: 'lte', val: parseFloat(lm[1]), date };

  // exact: "be X°C on"
  const em = ql.match(/be (\d+(?:\.\d+)?)°[cf] on/);
  if (em) return { cityKey: cityRaw, tempType, unit, cond: 'eq', val: parseFloat(em[1]), date };

  return null;
}

// ── Open-Meteo ──────────────────────────────────────────────────────────────
async function getActualTemp(city: CityData, dateStr: string, tempType: 'max' | 'min'): Promise<number | null> {
  const variable = tempType === 'max' ? 'temperature_2m_max' : 'temperature_2m_min';
  const daysDiff = (Date.now() - new Date(dateStr + 'T12:00:00').getTime()) / 86_400_000;

  try {
    let data: any;
    if (daysDiff <= 14) {
      const pastDays = Math.min(Math.ceil(daysDiff) + 1, 14);
      const r = await axios.get('https://api.open-meteo.com/v1/forecast', {
        params: { latitude: city.lat, longitude: city.lon, daily: variable, timezone: city.tz, past_days: pastDays, forecast_days: 1 },
        timeout: 10_000,
      });
      data = r.data;
    } else {
      const r = await axios.get('https://archive-api.open-meteo.com/v1/archive', {
        params: { latitude: city.lat, longitude: city.lon, start_date: dateStr, end_date: dateStr, daily: variable, timezone: city.tz },
        timeout: 10_000,
      });
      data = r.data;
    }
    const dates: string[] = data?.daily?.time ?? [];
    const temps: (number | null)[] = data?.daily?.[variable] ?? [];
    const idx = dates.indexOf(dateStr);
    if (idx === -1 || temps[idx] === null || temps[idx] === undefined) return null;
    return temps[idx] as number;
  } catch (err) {
    console.error(`[Weather] Open-Meteo: ${(err as Error).message}`);
    return null;
  }
}

// ── Verificar condição ──────────────────────────────────────────────────────
function checkOutcome(actualC: number, cond: WeatherCond): boolean | null {
  // Converte actual para a mesma unidade da condição
  const actual = cond.unit === 'F' ? (actualC * 9 / 5 + 32) : actualC;
  const rounded = Math.round(actual);

  switch (cond.cond) {
    case 'gte': return actual >= cond.val;
    case 'lte': return actual <= cond.val;
    case 'eq':  return rounded === Math.round(cond.val);
    case 'between':
      if (cond.val2 === undefined) return null;
      return rounded >= Math.round(cond.val) && rounded <= Math.round(cond.val2);
  }
}

// ── Estado ──────────────────────────────────────────────────────────────────
const entered   = new Set<string>();
let dailyPnl    = 0, dailyTrades = 0, dailyWins = 0;
let dailyDate   = new Date().toDateString();

function resetIfNewDay(): void {
  const today = new Date().toDateString();
  if (today !== dailyDate) {
    dailyDate = today; dailyPnl = 0; dailyTrades = 0; dailyWins = 0;
    entered.clear();
    console.error('[Weather] Novo dia — contadores resetados');
  }
}

function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

// ── Settle ──────────────────────────────────────────────────────────────────
async function settle(params: {
  label: string; betSide: 'YES' | 'NO'; entryPrice: number;
  shares: number; simulate: boolean; marketId: string;
}): Promise<void> {
  const { label, betSide, entryPrice, shares: _shares, simulate, marketId } = params;
  await sleep(60_000);

  let won: boolean | null = null;
  try {
    const r = await axios.get(`${config.gammaApiUrl}/markets`, {
      params: { conditionId: marketId, limit: 1 }, timeout: 8_000,
    });
    const list = Array.isArray(r.data) ? r.data : [];
    const m = list.find((x: any) => x.conditionId === marketId) ?? list[0];
    if (m?.outcomePrices) {
      const prices = typeof m.outcomePrices === 'string' ? JSON.parse(m.outcomePrices) : m.outcomePrices;
      const yesP = parseFloat(prices[0]);
      const noP  = parseFloat(prices[1]);
      if (!isNaN(yesP)) won = betSide === 'YES' ? yesP > noP : noP > yesP;
    }
  } catch {}

  if (won === null) won = false;
  const pnl = won ? BET_USDC * (1 / entryPrice - 1) : -BET_USDC;
  dailyPnl += pnl; dailyTrades++;
  if (won) dailyWins++;
  const wr = (dailyWins / dailyTrades * 100).toFixed(0);

  console.error(
    `[Weather] ${won ? '✅ WIN' : '❌ LOSS'} | "${label}" | ` +
    `PnL: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} | Dia: ${dailyPnl >= 0 ? '+' : ''}$${dailyPnl.toFixed(2)} | ${wr}% (${dailyWins}/${dailyTrades})`
  );

  await notify(
    `${simulate ? '[SIM] ' : ''}${won ? '✅ WIN' : '❌ LOSS'} WEATHER ${label} | ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`,
    [
      won ? `✅ GANHOU +$${pnl.toFixed(2)}` : `❌ PERDEU $${Math.abs(pnl).toFixed(2)}`,
      `${betSide} @ ${(entryPrice * 100).toFixed(1)}¢`,
      `📊 Hoje (Weather): ${dailyPnl >= 0 ? '+' : ''}$${dailyPnl.toFixed(2)} | ${dailyWins}/${dailyTrades} (${wr}%)`,
    ].join('\n')
  );
}

// ── Buscar todos os mercados (paginado) ─────────────────────────────────────
async function fetchAllMarkets(): Promise<any[]> {
  const all: any[] = [];
  let offset = 0;
  while (all.length < 600) {
    try {
      const r = await axios.get(`${config.gammaApiUrl}/markets`, {
        params: { active: true, limit: 100, offset, order: 'volume', ascending: false },
        timeout: 15_000,
      });
      const batch: any[] = r.data ?? [];
      all.push(...batch);
      if (batch.length < 100) break;
      offset += 100;
      await sleep(300);
    } catch (err) {
      console.error(`[Weather] Erro API offset ${offset}: ${(err as Error).message}`);
      break;
    }
  }
  return all;
}

// ── Ciclo principal ─────────────────────────────────────────────────────────
async function scanWeatherMarkets(simulate: boolean, client: ReturnType<typeof createClobClient>): Promise<void> {
  const all = await fetchAllMarkets();
  const now = Date.now();
  const todayStr = new Date().toISOString().slice(0, 10);
  let scanned = 0, parseFail = 0, futureSkip = 0, noData = 0, verified = 0, entries = 0;

  for (const market of all) {
    if (!market.conditionId || !market.endDate || !market.clobTokenIds) continue;
    if (entered.has(`weather-${market.conditionId}`)) continue;

    const question: string = market.question ?? '';
    if (!question.toLowerCase().includes('temperature')) continue;

    scanned++;

    const cond = parseQuestion(question, market.endDate);
    if (!cond) {
      parseFail++;
      if (parseFail <= 3) console.error(`[Weather] ⏭  Parse: "${question.slice(0, 70)}"`);
      continue;
    }

    // Só entra se o evento já aconteceu (hoje ou antes)
    if (cond.date > todayStr) { futureSkip++; continue; }

    // Consulta clima real
    const cityData = CITIES[cond.cityKey];
    const actualC = await getActualTemp(cityData, cond.date, cond.tempType);
    await sleep(150);
    if (actualC === null) { noData++; continue; }

    const yesWins = checkOutcome(actualC, cond);
    if (yesWins === null) continue;

    verified++;

    // Token IDs
    let tokenIds: string[];
    try { tokenIds = typeof market.clobTokenIds === 'string' ? JSON.parse(market.clobTokenIds) : market.clobTokenIds; }
    catch { continue; }
    const [yesTokenId, noTokenId] = tokenIds;

    const betSide: 'YES' | 'NO' = yesWins ? 'YES' : 'NO';
    const tokenId = betSide === 'YES' ? yesTokenId : noTokenId;

    const ob = await getOrderBookData(tokenId);
    await sleep(150);

    if (ob.bestAsk === null || ob.bestAsk > MAX_ENTRY) {
      if (ob.bestAsk !== null && ob.bestAsk > 0.005) {
        const actualDisp = cond.unit === 'F'
          ? `${(actualC * 9 / 5 + 32).toFixed(1)}°F`
          : `${actualC.toFixed(1)}°C`;
        console.error(
          `[Weather] ⏭  ${betSide}@${(ob.bestAsk * 100).toFixed(1)}¢ > ${(MAX_ENTRY * 100).toFixed(0)}¢ | ` +
          `Real: ${actualDisp} → ${betSide} | "${question.slice(0, 50)}"`
        );
      }
      continue;
    }

    entries++;
    entered.add(`weather-${market.conditionId}`);

    const shares    = parseFloat((BET_USDC / ob.bestAsk).toFixed(2));
    const potential = (BET_USDC * (1 / ob.bestAsk - 1)).toFixed(2);
    const hoursLeft = (new Date(market.endDate).getTime() - now) / 3_600_000;
    const actualDisp = cond.unit === 'F'
      ? `${(actualC * 9 / 5 + 32).toFixed(1)}°F`
      : `${actualC.toFixed(1)}°C`;
    const label = question.slice(0, 55);

    console.error(
      `[Weather] ✅ ${betSide} @ ${(ob.bestAsk * 100).toFixed(1)}¢ | ` +
      `Real: ${actualDisp} → ${betSide} | pot: +$${potential} | "${label}"`
    );

    if (!simulate) {
      const orderId = await buyShares(client, tokenId, ob.bestAsk, shares, false, 0.02);
      if (!orderId) {
        console.error(`[Weather] ⚠️  FOK cancelado: ${label}`);
        entered.delete(`weather-${market.conditionId}`);
        continue;
      }
      console.error(`[Weather] 📝 Ordem aceita: ${orderId}`);
    }

    await notify(
      `${simulate ? '[SIM] ' : ''}⚡ WEATHER ${betSide} @ ${(ob.bestAsk * 100).toFixed(1)}¢ | pot: +$${potential}`,
      [
        `🌡️  WEATHER ARBITRAGE`,
        ``,
        `📌 ${question}`,
        `🌡️  Clima real verificado: ${actualDisp}`,
        `✅ Resultado: ${betSide} vence`,
        `⏱ Resolve em ${hoursLeft.toFixed(1)}h`,
        ``,
        `💰 ${betSide} @ ${(ob.bestAsk * 100).toFixed(1)}¢ | $${BET_USDC} → ${shares} shares`,
        `💵 Potencial: +$${potential} (${((1 / ob.bestAsk - 1) * 100).toFixed(0)}% retorno)`,
        `📊 Dia Weather: ${dailyPnl >= 0 ? '+' : ''}$${dailyPnl.toFixed(2)}`,
      ].join('\n')
    );

    const msToEnd = new Date(market.endDate).getTime() - Date.now();
    setTimeout(async () => {
      try {
        await settle({ label, betSide, entryPrice: ob.bestAsk!, shares, simulate, marketId: market.conditionId });
      } catch (err) {
        console.error(`[Weather] Settle error: ${(err as Error).message}`);
      }
    }, Math.max(msToEnd + 90_000, 30_000));
  }

  console.error(
    `[Weather] Scan: ${all.length} mercados → ${scanned} clima → parse_ok:${scanned - parseFail} parse_fail:${parseFail} futuro:${futureSkip} sem_dados:${noData} → ${verified} verificados → ${entries} entradas`
  );
}

// ── Entry point ─────────────────────────────────────────────────────────────
export async function startWeatherScanner(simulate: boolean): Promise<void> {
  const client = createClobClient();
  console.error(
    `[Weather] Iniciando — entrada máx: ${(MAX_ENTRY * 100).toFixed(0)}¢ | ` +
    `aposta: $${BET_USDC} | scan: ${SCAN_SECS}s | cidades: ${Object.keys(CITIES).length}`
  );
  while (true) {
    resetIfNewDay();
    try { await scanWeatherMarkets(simulate, client); }
    catch (err) { console.error(`[Weather] Erro crítico: ${(err as Error).message}`); }
    await sleep(SCAN_INTERVAL);
  }
}
