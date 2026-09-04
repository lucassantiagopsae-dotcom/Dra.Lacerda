// Webhook do Agendor — recebe as mudancas de etapa do funil.
//
// Mesmo padrao dos adaptadores de plataforma de venda deste stack: a rota e
// protegida apenas por um slug impossivel de adivinhar (AGENDOR_WEBHOOK_SLUG),
// que e como n8n, Zapier e Stripe tambem fazem. Slug errado = 404, sem pista
// de que o endpoint existe.
//
// A logica de verdade fica em _crm_events.js; aqui so entra o que e da rota.

import { handleAgendorEvent } from '../../_crm_events.js';

export async function onRequestPost(context) {
  const { request, env, params } = context;

  if (!env.AGENDOR_WEBHOOK_SLUG || params.slug !== env.AGENDOR_WEBHOOK_SLUG) {
    return new Response('Not found', { status: 404 });
  }

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return json({ error: 'invalid json' }, 400);
  }

  // O Agendor manda o nome do gatilho ora no corpo, ora no cabecalho.
  const hook = body.event
    || body.trigger
    || request.headers.get('x-agendor-event')
    || 'on_deal_stage_updated';

  try {
    const result = await handleAgendorEvent({ body, hook, env, context });
    // Sempre 200: webhook que responde erro vira fila de reentrega no
    // Agendor, e uma etapa sem mapeamento nao e falha nossa.
    return json({ ok: true, ...result });
  } catch (e) {
    console.error('agendor webhook error:', e.message);
    return json({ ok: false, error: e.message });
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
