import OpenAI from 'openai';

let _client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY!,
      baseURL: 'https://api.deepseek.com',
    });
  }
  return _client;
}

export interface AIAnalysis {
  questionPT: string;
  probability: number;   // 0-100, estimated real probability
  confidence: number;    // 0-100, AI confidence in its estimate
  reasoning: string;
  edge: number;          // AI prob - market prob
}

export async function analyzeMarket(
  question: string,
  marketProb: number,
  liquidity: number,
  daysToEnd: number,
): Promise<AIAnalysis | null> {
  if (!process.env.DEEPSEEK_API_KEY) return null;

  const prompt = `Você é um analista especializado em mercados de previsão de criptomoedas.

PERGUNTA DO MERCADO: "${question}"
PROBABILIDADE ATUAL NO MERCADO: ${marketProb.toFixed(1)}%
LIQUIDEZ DO MERCADO: $${liquidity.toFixed(0)} (baixo volume = mais chance de preço errado)
DIAS ATÉ ENCERRAMENTO: ${daysToEnd.toFixed(0)} dias

Analise se a probabilidade do mercado está correta ou se há uma ineficiência.
Considere: tendências recentes de crypto, dados on-chain, contexto macroeconômico, adoção institucional.

Responda APENAS com JSON válido (sem markdown):
{
  "questionPT": "<tradução para português>",
  "probability": <sua estimativa real de 0 a 100>,
  "confidence": <sua confiança de 0 a 100>,
  "reasoning": "<análise em 2-3 frases em português>",
  "hasEdge": <true se |sua_prob - mercado_prob| > 10 e confiança > 60>
}`;

  try {
    const response = await getClient().chat.completions.create({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: 'Analista quantitativo de mercados de previsão crypto. Responda APENAS com JSON válido, sem texto fora do JSON.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 400,
      temperature: 0.2,
    });

    const raw = response.choices[0]?.message?.content ?? '';
    const jsonMatch = raw.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim().match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const p = JSON.parse(jsonMatch[0]);
    const prob = Math.max(0, Math.min(100, Number(p.probability)));
    const confidence = Math.max(0, Math.min(100, Number(p.confidence)));

    return {
      questionPT: String(p.questionPT ?? question),
      probability: prob,
      confidence,
      reasoning: String(p.reasoning ?? ''),
      edge: prob - marketProb,
    };
  } catch (err) {
    console.error('[AI] Erro:', (err as Error).message);
    return null;
  }
}
