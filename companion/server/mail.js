'use strict';
/* Email through Resend's HTTP API (https://resend.com). Set RESEND_API_KEY and
   MAIL_FROM (e.g. "THE LAB <hello@trainwiththelab.com>", on a domain verified
   in Resend). Without a key, messages are logged instead of sent. */
function createMailer({ apiKey, from, fetchImpl = globalThis.fetch, log = console.log } = {}) {
  const enabled = !!(apiKey && from);
  async function send({ to, subject, text, html }) {
    if (!enabled) { log(`[mail disabled] to=${to} subject=${subject}\n${text}`); return { sent: false }; }
    const res = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, text, html })
    });
    if (!res.ok) { const body = await res.text().catch(() => ''); throw new Error(`Email failed (${res.status}): ${body.slice(0, 200)}`); }
    return { sent: true };
  }
  /* Fire-and-forget: a mail outage never breaks the request that triggered it. */
  function sendSoon(msg) { send(msg).catch(e => log(`[mail error] ${e.message}`)); }
  return { enabled, send, sendSoon };
}
module.exports = { createMailer };
