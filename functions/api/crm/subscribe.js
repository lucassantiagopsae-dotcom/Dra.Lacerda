// Registra (GET lista / POST cria) as assinaturas de webhook no Agendor.
//
// Existe para que ninguem precise manusear o AGENDOR_TOKEN para configurar os
// gatilhos: o Worker ja tem o token como secret e fala com o Agendor por conta
// propria. Quem opera so abre a URL com a DASH_KEY.
//
//   GET  /api/crm/subscribe?key=<DASH_KEY>   -> lista as assinaturas atuais
//   POST /api/crm/subscribe?key=<DASH_KEY>   -> cria as que faltam (idempotente)

const AGENDOR_API = 'https://api.agendor.com.br';

// on_deal_stage_updated cobre QUALIFICADO, CONSULTA AGENDADA e GANHO.
// on_deal_won entra porque marcar o negocio como ganho nem sempre passa por
// mudanca de etapa — o event_id deterministico impede contagem dobrada.
const EVENTOS = ['on_deal_stage_updated', 'on_deal_won'];

export async function onRequestGet(context) {
  const guard = checar(context);
  if (guard) return guard;

  const r = await fetch(`${AGENDOR_API}/integrations/subscriptions`, {
    headers: cabecalhos(context.env),
  });
  const body = await r.text();
  return json({ status: r.status, subscriptions: parse(body), alvo: alvo(context) });
}

export async function onRequestPost(context) {
  const guard = checar(context);
  if (guard) return guard;

  const { env } = context;
  const targetUrl = alvo(context);

  const atuais = await fetch(`${AGENDOR_API}/integrations/subscriptions`, {
    headers: cabecalhos(env),
  }).then(r => r.text()).then(parse).catch(() => null);

  const jaExiste = (evento) => {
    const lista = (atuais && (atuais.data || atuais)) || [];
    return Array.isArray(lista) && lista.some(s =>
      (s.event === evento) && (s.target_url === targetUrl)
    );
  };

  const resultados = [];
  for (const evento of EVENTOS) {
    if (jaExiste(evento)) {
      resultados.push({ evento, status: 'ja existia' });
      continue;
    }
    const r = await fetch(`${AGENDOR_API}/integrations/subscriptions`, {
      method: 'POST',
      headers: cabecalhos(env),
      body: JSON.stringify({ target_url: targetUrl, event: evento }),
    });
    resultados.push({ evento, status: r.status, resposta: parse(await r.text()) });
  }

  return json({ alvo: targetUrl, resultados });
}

function checar({ request, env }) {
  const key = new URL(request.url).searchParams.get('key');
  if (!env.DASH_KEY || key !== env.DASH_KEY) return json({ error: 'Unauthorized' }, 401);
  if (!env.AGENDOR_TOKEN) return json({ error: 'AGENDOR_TOKEN nao configurado' }, 400);
  if (!env.AGENDOR_WEBHOOK_SLUG) return json({ error: 'AGENDOR_WEBHOOK_SLUG nao configurado' }, 400);
  return null;
}

function alvo({ request, env }) {
  return `${new URL(request.url).origin}/webhook/agendor/${env.AGENDOR_WEBHOOK_SLUG}`;
}

function cabecalhos(env) {
  return {
    'Authorization': `Token ${env.AGENDOR_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

function parse(text) {
  try { return JSON.parse(text); } catch (_) { return text; }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
