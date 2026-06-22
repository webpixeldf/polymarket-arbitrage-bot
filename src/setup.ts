/**
 * Setup — gera credenciais de API da Polymarket e salva no .env
 * Uso: npx ts-node src/setup.ts
 */
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { ethers } from 'ethers';
import { ClobClient } from '@polymarket/clob-client';

dotenv.config();

async function setup(): Promise<void> {
  const privateKey  = process.env.PRIVATE_KEY ?? '';
  const proxyWallet = process.env.PROXY_WALLET_ADDRESS ?? '';
  const clobUrl     = process.env.CLOB_API_URL ?? 'https://clob.polymarket.com';

  if (!privateKey) {
    console.error('❌ PRIVATE_KEY não encontrada no .env');
    process.exit(1);
  }

  const wallet = new ethers.Wallet(privateKey);
  console.log(`Carteira: ${wallet.address}`);
  console.log('Gerando credenciais de API (assina mensagem com a carteira)...\n');

  const client = new ClobClient(clobUrl, 137, wallet, undefined, 2 as any, proxyWallet || undefined);

  try {
    // deriveApiKey gera credenciais determinísticas a partir da carteira
    const creds = await (client as any).deriveApiKey();

    if (!creds?.key) throw new Error('Credenciais inválidas retornadas pela API');

    console.log('✅ Credenciais geradas:');
    console.log(`   API_KEY=${creds.key}`);
    console.log(`   API_SECRET=${creds.secret}`);
    console.log(`   API_PASSPHRASE=${creds.passphrase}`);

    // Salva no .env
    const envPath = path.join(process.cwd(), '.env');
    let env = fs.readFileSync(envPath, 'utf8');
    env = env
      .replace(/API_KEY=.*/, `API_KEY=${creds.key}`)
      .replace(/API_SECRET=.*/, `API_SECRET=${creds.secret}`)
      .replace(/API_PASSPHRASE=.*/, `API_PASSPHRASE=${creds.passphrase}`);
    fs.writeFileSync(envPath, env);

    console.log('\n✅ .env atualizado! Reinicie o bot:');
    console.log('   pm2 restart polymarket-bot --update-env\n');
  } catch (err) {
    console.error('❌ Erro:', (err as Error).message);
    process.exit(1);
  }
}

setup();
