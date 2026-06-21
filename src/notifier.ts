import * as nodemailer from 'nodemailer';

const gmailUser = process.env.GMAIL_USER ?? '';
// Remove spaces from app password (Google shows with spaces but SMTP needs without)
const gmailPass = (process.env.GMAIL_APP_PASSWORD ?? '').replace(/\s/g, '');
const gmailTo   = process.env.GMAIL_TO ?? gmailUser;

const enabled = !!(gmailUser && gmailPass);

const transporter = enabled
  ? nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false, // STARTTLS — port 465 blocked on Railway
      auth: { user: gmailUser, pass: gmailPass },
    })
  : null;

export async function notify(subject: string, body: string): Promise<void> {
  if (!enabled || !transporter) {
    console.error('[EMAIL] Desativado — GMAIL_USER ou GMAIL_APP_PASSWORD não configurados.');
    return;
  }
  console.error(`[EMAIL] Enviando para ${gmailTo}: ${subject.slice(0, 60)}`);
  try {
    await transporter.sendMail({
      from: `"Polymarket Bot" <${gmailUser}>`,
      to: gmailTo,
      subject,
      text: body,
    });
    console.error(`[EMAIL] ✅ Enviado com sucesso!`);
  } catch (err) {
    console.error(`[EMAIL] ❌ Falha:`, (err as Error).message);
  }
}

export async function sendStartupEmail(simulate: boolean): Promise<void> {
  const mode = simulate ? 'SIMULAÇÃO' : 'PRODUÇÃO';
  await notify(
    `[Polymarket Bot] Iniciado em modo ${mode}`,
    `O bot Polymarket foi iniciado com sucesso.\n\nModo: ${mode}\nHorário: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}\n\nFase 1: Arbitragem BTC/ETH\nFase 2: Value Bets com IA (Copa, Eleições, Clima)\n\nVocê receberá alertas quando oportunidades forem detectadas.`
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
