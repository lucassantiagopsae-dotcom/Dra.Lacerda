import { sendLeadToAgendor } from '../_agendor.js';

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) {
    return json({ error: 'Origem inválida.' }, 403);
  }
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return json({ error: 'Formato inválido.' }, 415);
  }

  try {
    const body = await request.json();
    const name = String(body.name || '').trim().slice(0, 160);
    const phone = String(body.phone || '').replace(/\D/g, '');
    if (!name || !/^\d{10,11}$/.test(phone)) {
      return json({ error: 'Confira seu nome e WhatsApp com DDD.' }, 400);
    }
    if (!env.AGENDOR_TOKEN) {
      return json({ error: 'Atendimento indisponível. Tente novamente em instantes.' }, 503);
    }

    const cookies = Object.fromEntries((request.headers.get('cookie') || '').split(';').map(part => {
      const index = part.indexOf('=');
      return index < 0 ? ['', ''] : [part.slice(0, index).trim(), part.slice(index + 1).trim()];
    }));
    const sessionId = cookies._krob_sid || '';
    let session = {};
    if (sessionId && env.DB) {
      session = await env.DB.prepare('SELECT * FROM sessions WHERE session_id = ?').bind(sessionId).first() || {};
    }

    const landing = new URL(String(body.landingUrl || ''), request.url);
    if (landing.origin !== new URL(request.url).origin) {
      return json({ error: 'Página de origem inválida.' }, 400);
    }
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'gbraid', 'wbraid', 'fbclid']) {
      if (!session[key]) session[key] = landing.searchParams.get(key) || '';
    }
    if (!session.landing_url) session.landing_url = landing.toString();
    if (!session.referrer) session.referrer = request.headers.get('referer') || '';

    const result = await sendLeadToAgendor({
      lead: { name, phone },
      session,
      eventId: crypto.randomUUID(),
      sessionId,
      env,
      db: env.DB,
    });
    const dealRequired = env.AGENDOR_CREATE_DEAL !== 'false';
    if (!result.ok || (dealRequired && !result.dealId)) {
      return json({ error: 'Não foi possível confirmar o atendimento. Tente novamente.' }, 503);
    }
    return json({ ok: true });
  } catch (error) {
    console.error('Lead before WhatsApp:', error);
    return json({ error: 'Não foi possível confirmar o atendimento. Tente novamente.' }, 503);
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
