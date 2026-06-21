import Parser from 'rss-parser';

const parser = new Parser({ timeout: 10000 });

export type Category = 'worldcup' | 'elections' | 'climate' | 'politics' | 'finance' | 'sports' | 'tech' | 'geopolitics' | 'general';

const RSS_SOURCES: Record<Category, string[]> = {
  worldcup: [
    'https://news.google.com/rss/search?q=FIFA+World+Cup+2026&hl=en&gl=US&ceid=US:en',
    'https://news.google.com/rss/search?q=Copa+do+Mundo+2026&hl=pt&gl=BR&ceid=BR:pt',
    'https://www.espn.com/espn/rss/soccer/news',
    'https://feeds.bbci.co.uk/sport/football/rss.xml',
  ],
  elections: [
    'https://news.google.com/rss/search?q=election+2026+polls&hl=en&gl=US&ceid=US:en',
    'https://news.google.com/rss/search?q=eleicoes+brasil+2026&hl=pt&gl=BR&ceid=BR:pt',
    'https://news.google.com/rss/search?q=presidential+election+polls&hl=en&gl=US&ceid=US:en',
  ],
  climate: [
    'https://news.google.com/rss/search?q=weather+extreme+record&hl=en&gl=US&ceid=US:en',
    'https://news.google.com/rss/search?q=hurricane+tropical+storm+2026&hl=en&gl=US&ceid=US:en',
    'https://news.google.com/rss/search?q=climate+temperature+record&hl=en&gl=US&ceid=US:en',
  ],
  politics: [
    'https://news.google.com/rss/search?q=US+politics+2026&hl=en&gl=US&ceid=US:en',
    'https://news.google.com/rss/search?q=Trump+Congress+Senate&hl=en&gl=US&ceid=US:en',
    'https://feeds.bbci.co.uk/news/politics/rss.xml',
  ],
  finance: [
    'https://news.google.com/rss/search?q=Federal+Reserve+interest+rate+2026&hl=en&gl=US&ceid=US:en',
    'https://news.google.com/rss/search?q=stock+market+economy+recession&hl=en&gl=US&ceid=US:en',
    'https://feeds.bbci.co.uk/news/business/rss.xml',
  ],
  sports: [
    'https://news.google.com/rss/search?q=sports+championship+2026&hl=en&gl=US&ceid=US:en',
    'https://www.espn.com/espn/rss/news',
  ],
  tech: [
    'https://news.google.com/rss/search?q=AI+artificial+intelligence+2026&hl=en&gl=US&ceid=US:en',
    'https://news.google.com/rss/search?q=technology+Apple+Google+OpenAI&hl=en&gl=US&ceid=US:en',
  ],
  geopolitics: [
    'https://news.google.com/rss/search?q=Iran+war+sanctions+2026&hl=en&gl=US&ceid=US:en',
    'https://news.google.com/rss/search?q=Russia+Ukraine+China+Taiwan+2026&hl=en&gl=US&ceid=US:en',
    'https://feeds.bbci.co.uk/news/world/rss.xml',
  ],
  general: [
    'https://feeds.bbci.co.uk/news/rss.xml',
  ],
};

export interface NewsItem {
  title: string;
  summary: string;
  source: string;
  published: string;
}

export async function fetchNews(category: Category, query?: string): Promise<NewsItem[]> {
  const urls = query
    ? [`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en&gl=US&ceid=US:en`]
    : RSS_SOURCES[category];

  const allItems: NewsItem[] = [];

  await Promise.allSettled(
    urls.map(async (url) => {
      try {
        const feed = await parser.parseURL(url);
        const items = (feed.items ?? []).slice(0, 5).map(item => ({
          title: item.title ?? '',
          summary: item.contentSnippet ?? item.summary ?? '',
          source: feed.title ?? url,
          published: item.pubDate ?? new Date().toISOString(),
        }));
        allItems.push(...items);
      } catch {
        // silently skip failed sources
      }
    })
  );

  const seen = new Set<string>();
  return allItems
    .filter(item => {
      const key = item.title.toLowerCase().slice(0, 50);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 10);
}

export function detectCategory(question: string): Category {
  const q = question.toLowerCase();

  if (q.includes('world cup') || q.includes('fifa') || q.includes('copa') ||
      q.includes('soccer') || (q.includes('football') && !q.includes('nfl')) ||
      q.includes('goal') || q.includes('tournament') || q.includes('semifinal') ||
      q.includes('copa do mundo')) return 'worldcup';

  if (q.includes('election') || q.includes('president') || q.includes('senator') ||
      q.includes('governor') || q.includes('ballot') || q.includes('eleic') ||
      q.includes('candidat') || q.includes('primary') || q.includes('parliament')) return 'elections';

  if (q.includes('hurricane') || q.includes('storm') || q.includes('flood') ||
      q.includes('drought') || q.includes('wildfire') || q.includes('tornado') ||
      q.includes('earthquake') || q.includes('climate') || q.includes('temperature') ||
      q.includes('weather') || q.includes('rainfall') || q.includes('el nino')) return 'climate';

  if (q.includes('trump') || q.includes('congress') || q.includes('senate') ||
      q.includes('democrat') || q.includes('republican') || q.includes('legislation') ||
      q.includes('supreme court') || q.includes('white house') || q.includes('bill')) return 'politics';

  if (q.includes('fed') || q.includes('interest rate') || q.includes('inflation') ||
      q.includes('gdp') || q.includes('recession') || q.includes('stock') ||
      q.includes('dow') || q.includes('nasdaq') || q.includes('economy') ||
      q.includes('treasury') || q.includes('tariff')) return 'finance';

  if (q.includes('iran') || q.includes('russia') || q.includes('ukraine') ||
      q.includes('china') || q.includes('taiwan') || q.includes('nato') ||
      q.includes('war') || q.includes('sanction') || q.includes('missile') ||
      q.includes('north korea') || q.includes('nuclear')) return 'geopolitics';

  if (q.includes('nfl') || q.includes('nba') || q.includes('nhl') ||
      q.includes('mlb') || q.includes('formula') || q.includes('tennis') ||
      q.includes('basketball') || q.includes('baseball') || q.includes('ufc')) return 'sports';

  if (q.includes('ai') || q.includes('openai') || q.includes('apple') ||
      q.includes('google') || q.includes('microsoft') || q.includes('technology') ||
      q.includes('elon') || q.includes('meta') || q.includes('model')) return 'tech';

  return 'general';
}
