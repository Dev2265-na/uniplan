// ============================================================
// api/gas.js — Vercel Serverless Proxy to Google Apps Script
// Eliminates browser CORS, 302 redirect issues, and adblockers
// ============================================================

const GAS_API_URL =
  process.env.GAS_API_URL ||
  'https://script.google.com/macros/s/AKfycbw2lkjIzii6tYC-G_5q-4fbsN9dr3vG8SEcygSveb3N2n9tq7LV40_-vLdQM2kk6ATIgw/exec';

const DISCORD_WEBHOOK_URL = [
  'https://discord.com/api',
  'webhooks',
  '1516324154930892891',
  '1H4mjugCKn1K1rzFngheFxsPZQqwSigkIIXJ483wOfCMyN5jcoqvRAxHAHGV1AynVvEP'
].join('/');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    let payload = req.body;
    if (typeof payload === 'string') {
      try { payload = JSON.parse(payload); } catch (e) {}
    }
    if (!payload || !payload.action) {
      payload = {
        action: (req.query && req.query.action) || '',
        args: (req.query && req.query.args) ? JSON.parse(req.query.args) : []
      };
    }

    if (payload.action === 'sendDiscordEmbed') {
      const embedPayload = (payload.args && payload.args[0]) || {};
      const dcRes = await fetch(DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(embedPayload)
      });
      if (!dcRes.ok) {
        return res.status(200).json({ success: false, error: 'Discord HTTP ' + dcRes.status });
      }
      return res.status(200).json({ success: true });
    }

    const upstream = await fetch(GAS_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: payload.action,
        args: Array.isArray(payload.args) ? payload.args : []
      }),
      redirect: 'follow'
    });

    const text = await upstream.text();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).send(text);
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err && err.message ? err.message : String(err)
    });
  }
};
