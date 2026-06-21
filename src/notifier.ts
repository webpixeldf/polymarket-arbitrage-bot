import * as nodemailer from 'nodemailer';

const gmailUser = process.env.GMAIL_USER ?? '';
const gmailPass = process.env.GMAIL_APP_PASSWORD ?? '';
const gmailTo   = process.env.GMAIL_TO ?? gmailUser;

const enabled = !!(gmailUser && gmailPass);

const transporter = enabled
  ? nodemailer.createTransport({
      service: 'gmail',
      auth: { user: gmailUser, pass: gmailPass },
    })
  : null;

export async function notify(subject: string, body: string): Promise<void> {
  if (!enabled || !transporter) return;
  try {
    await transporter.sendMail({
      from: `"Polymarket Bot" <${gmailUser}>`,
      to: gmailTo,
      subject,
      text: body,
    });
    console.error(`[EMAIL] Enviado: ${subject}`);
  } catch (err) {
    console.error(`[EMAIL] Falha ao enviar:`, (err as Error).message);
  }
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
