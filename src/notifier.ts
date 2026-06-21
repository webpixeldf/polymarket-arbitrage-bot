import * as nodemailer from 'nodemailer';
import axios from 'axios';

// ── Telegram ──────────────────────────────────────────────────────────────────
const tgToken  = process.env.TELEGRAM_BOT_TOKEN ?? '';
const tgChatId = process.env.TELEGRAM_CHAT_ID ?? '';
const tgEnabled = !!(tgToken && tgChatId);

async function sendTelegram(text: string): Promise<void> {
  if (!tgEnabled) return;
  try {
    await axios.post(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
      chat_id: tgChatId,
      text,
      parse_mode: 'HTML',
    }, { timeout: 10000 });
    console.error('[TELEGRAM] ✅ Mensagem enviada!');
  } catch (err) {
    console.error('[TELEGRAM] ❌ Falha:', (err as Error).message);
  }
}

// ── Gmail (fallback) ──────────────────────────────────────────────────────────
const gmailUser = process.env.GMAIL_USER ?? '';
const gmailPass = (process.env.GMAIL_APP_PASSWORD ?? '').replace(/\s/g, '');
const gmailTo   = process.env.GMAIL_TO ?? gmailUser;
const emailEnabled = !!(gmailUser && gmailPass);

const transporter = emailEnabled
  ? nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: { user: gmailUser, pass: gmailPass },
    })
  : null;

async function sendEmail(subject: string, body: string): Promise<void> {
  if (!emailEnabled || !transporter) return;
  console.error(`[EMAIL] Enviando para ${gmailTo}: ${subject.slice(0, 60)}`);
  try {
    await transporter.sendMail({
      from: `"Polymarket Bot" <${gmailUser}>`,
      to: gmailTo,
      subject,
      text: body,
    });
    console.error('[EMAIL] ✅ Enviado!');
  } catch (err) {
    console.error('[EMAIL] ❌ Falha:', (err as Error).message);
  }
}

// ── Unified notify ────────────────────────────────────────────────────────────
export async function notify(subject: string, body: string): Promise<void> {
  // Telegram: short summary (4096 char limit)
  const tgMsg = `<b>${subject}</b>\n\n${body.slice(0, 3800)}`;
  await sendTelegram(tgMsg);
  // Email: full body (parallel, ignore if SMTP blocked)
  await sendEmail(subject, body);
}

export async function sendStartupEmail(simulate: boolean): Promise<void> {
  const mode = simulate ? 'SIMULAÇÃO' : 'PRODUÇÃO';
  const hora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  await notify(
    `🤖 Polymarket Bot iniciado — ${mode}`,
    `Bot iniciado com sucesso!\n\nModo: ${mode}\nHorário: ${hora}\n\nFase 2: Value Bets com IA ativos.\nVocê receberá alertas quando oportunidades forem detectadas.`
  );
}

export async function notifyOpportunity(params: {
  asset: string;
  leg: 'UP' | 'DOWN';
  leg1Price: number;
  leg2Price: number;
  combined: number;
  target: number;
  mode: 'hedge' | 'stop-loss';
  simulate: boolean;
}): Promise<void> {
  const { asset, leg, leg1Price, leg2Price, combined, target, mode, simulate } = params;
  const modeLabel = mode === 'hedge' ? '✅ HEDGE COM LUCRO' : '⚠️ STOP-LOSS';
  const simLabel  = simulate ? '[SIMULACAO] ' : '';

  const subject = `${simLabel}${asset.toUpperCase()} — ${modeLabel} detectado`;
  const body = [
    `Ativo: ${asset.toUpperCase()}`,
    `Perna detectada (dump): ${leg}`,
    `Preço Perna 1 (dump): ${leg1Price.toFixed(4)}`,
    `Preço Perna 2 (hedge): ${leg2Price.toFixed(4)}`,
    `Custo combinado: ${combined.toFixed(4)}`,
    `Target: ${target.toFixed(4)}`,
    `Resultado esperado: ${combined < target ? `+${((1 - combined) * 100).toFixed(2)}% de lucro` : 'Stop-loss executado'}`,
    `Modo: ${mode.toUpperCase()}`,
    ``,
    simulate ? 'SIMULACAO — nenhuma ordem real foi executada.' : 'Ordem REAL executada.',
  ].join('\n');

  await notify(subject, body);
}
