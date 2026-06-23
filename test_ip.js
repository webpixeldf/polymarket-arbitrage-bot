'use strict';
require('dotenv').config({ override: true });
if (process.env.WEBSHARE_PROXY_URL) {
  process.env.GLOBAL_AGENT_HTTPS_PROXY = process.env.WEBSHARE_PROXY_URL;
  require('global-agent/bootstrap');
}
const axios = require('axios');

async function main() {
  console.log('Proxy configurado:', process.env.WEBSHARE_PROXY_URL || 'NENHUM');

  // Verifica qual IP o servidor vê
  try {
    const r = await axios.get('https://api.ipify.org?format=json', { timeout: 8000 });
    console.log('IP visto pelo servidor:', r.data.ip);
  } catch(e) { console.log('Erro ipify:', e.message); }

  try {
    const r = await axios.get('https://ipapi.co/json', { timeout: 8000 });
    console.log('País:', r.data.country_name, '| Cidade:', r.data.city, '| IP:', r.data.ip);
  } catch(e) { console.log('Erro ipapi:', e.message); }

  // Testa se o CLOB vê X-Forwarded-For
  try {
    const r = await axios.get('https://clob.polymarket.com/time', { timeout: 8000 });
    console.log('CLOB /time:', JSON.stringify(r.data));
  } catch(e) { console.log('Erro CLOB /time:', e.message); }
}

main().catch(console.error);
