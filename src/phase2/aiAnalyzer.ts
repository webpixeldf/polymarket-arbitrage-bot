import OpenAI from 'openai';
import { NewsItem } from './newsCollector';

const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY ?? '',
  baseURL: 'https://api.deepseek.com',
});

export interface AIAnalysis {
  probability: number;   // 0-100
  confidence: number;    // 0-100
  reasoning: string;
  bullishFactors: string[];
  bearishFactors: string[];
}

export async function analyzeMarket(
  question: string,
  marketProbability: number,
  news: NewsItem[]
): Promise<AIAnalysis | null> {
  if (!process.env.DEEPSEEK_API_KEY) return null;

  const newsText = news.length > 0
    ? news.map(n => `- [${n.source}] ${n.title}: ${n.summary}`).join('\n')
    : 'Nenhuma notícia recente encontrada.';

  const prompt = `Você é um analista quantitativo especializado em mercados de previsão.

PERGUNTA DO MERCADO: "${question}"
PROBABILIDADE ATUAL NO MERCADO: ${marketProbability.toFixed(1)}%

NOTÍCIAS RECENTES RELEVANTES:
${newsText}

Com base nas notícias e no seu conhecimento, estime a probabilidade REAL de que essa pergunta resolva como "SIM" (YES).

Responda APENAS com um JSON válido neste formato exato:
{
  "probability": <número de 0 a 100>,
  "confidence": <sua confiança na estimativa, de 0 a 100>,
  "reasoning": "<explicação em 2-3 frases>",
  "bullishFactors": ["<fator favorável ao YES>", "..."],
  "bearishFactors": ["<fator favorável ao NO>", "..."]
}`;

  try {
    const response = await client.chat.completions.create({
      model: 'deepseek-chat',
      messages: [
        {
          role: 'system',
          content: 'You are a quantitative analyst for prediction markets. Always respond with valid JSON only, no markdown, no explanation outside the JSON.',
        },
        { role: 'user', content: prompt },
      ],
      max_tokens: 600,
      temperature: 0.3,
    });

    const raw = response.choices[0]?.message?.content ?? '';
    // Strip markdown code fences if present
    const clean = raw.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
    const jsonMatch = clean.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[AI] No JSON in response:', raw.slice(0, 200));
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    const result = {
      probability: Math.max(0, Math.min(100, Number(parsed.probability))),
      confidence: Math.max(0, Math.min(100, Number(parsed.confidence))),
      reasoning: String(parsed.reasoning ?? ''),
      bullishFactors: Array.isArray(parsed.bullishFactors) ? parsed.bullishFactors : [],
      bearishFactors: Array.isArray(parsed.bearishFactors) ? parsed.bearishFactors : [],
    };
    console.error(`[AI] "${question.slice(0, 50)}" → market:${marketProbability.toFixed(1)}% AI:${result.probability.toFixed(1)}% conf:${result.confidence.toFixed(0)}%`);
    return result;
  } catch (err) {
    console.error('[AI] DeepSeek error:', (err as Error).message);
    return null;
  }
}
