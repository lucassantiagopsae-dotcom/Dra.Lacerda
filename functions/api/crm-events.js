// GET /api/crm-events?key=...&days=30
//
// O funil inteiro em um lugar: quantos entraram pelo site e quantos chegaram a
// cada etapa do CRM. Existe porque o resto do painel so enxerga a metade de
// cima — ate aqui nao havia como responder "os disparos do CRM estao mesmo
// indo pra Meta?" sem abrir o banco na mao.
//
// Devolve tres coisas:
//   funil    contagem por evento na janela, do Lead ao Purchase
//   eventos  os ultimos eventos vindos do CRM, com origem e resposta da Meta
//   falhas   webhooks que chegaram e NAO viraram evento, com o motivo
//
// A ultima e a mais importante das tres: sucesso a gente ve na contagem, mas
// silencio — etapa sem mapeamento, pessoa que nao veio do site — so aparece
// se alguem for atras.

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (!env.DASH_KEY || url.searchParams.get('key') !== env.DASH_KEY) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const days = clampInt(url.searchParams.get('days'), 30, 1, 365);
  const since = Math.floor(Date.now() / 1000) - days * 86400;

  try {
    // Os eventos do CRM sao marcados com consent_status = 'crm' na gravacao,
    // que e o que os separa dos homonimos disparados pelo navegador.
    const funil = await env.DB.prepare(`
      SELECT event_name, COUNT(*) AS total,
             SUM(CASE WHEN meta_response_ok = 1 THEN 1 ELSE 0 END) AS aceitos
      FROM event_log
      WHERE timestamp >= ? AND is_bot = 0
        AND event_name IN ('Lead', 'QualifiedLead', 'Schedule', 'Purchase')
      GROUP BY event_name
    `).bind(since).all();

    const eventos = await env.DB.prepare(`
      SELECT e.event_name, e.event_id, e.timestamp, e.raw_name, e.raw_phone,
             e.meta_status_code, e.meta_response_ok, e.meta_response_body,
             e.meta_payload_sent,
             s.utm_source, s.utm_campaign
      FROM event_log e
      LEFT JOIN sessions s ON s.session_id = e.session_id
      WHERE e.consent_status = 'crm' AND e.timestamp >= ?
      ORDER BY e.timestamp DESC
      LIMIT 100
    `).bind(since).all();

    const falhas = await env.DB.prepare(`
      SELECT created_at, provider, person_id, deal_id, request_payload, response_body
      FROM crm_log
      WHERE provider LIKE 'agendor-webhook%' AND ok = 0 AND created_at >= ?
        -- "ja enviado antes" e o dedupe funcionando: o card voltou para uma
        -- etapa e foi arrastado de novo. Listar isso como falha treina a
        -- pessoa a ignorar a tabela inteira.
        AND response_body NOT LIKE 'ja enviado antes%'
      ORDER BY id DESC
      LIMIT 50
    `).bind(since).all();

    return json({
      days,
      funil: montarFunil(funil.results || []),
      eventos: (eventos.results || []).map(limpar),
      falhas: (falhas.results || []).map(descreverFalha),
    });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}

// Ordem fixa, e etapa sem nenhum evento aparece zerada em vez de sumir — um
// zero em CONSULTA AGENDADA e informacao, a ausencia da linha nao e.
function montarFunil(rows) {
  const ordem = ['Lead', 'QualifiedLead', 'Schedule', 'Purchase'];
  const porNome = Object.fromEntries(rows.map(r => [r.event_name, r]));
  return ordem.map(nome => ({
    evento: nome,
    total: porNome[nome] ? porNome[nome].total : 0,
    aceitos: porNome[nome] ? porNome[nome].aceitos : 0,
  }));
}

function limpar(r) {
  let valor = 0;
  try {
    const cd = JSON.parse(r.meta_payload_sent).data[0].custom_data;
    if (cd && cd.value) valor = Number(cd.value);
  } catch (_) { /* evento sem custom_data: valor fica zero */ }

  return {
    event_name: r.event_name,
    event_id: r.event_id,
    timestamp: r.timestamp,
    nome: r.raw_name || '',
    telefone: r.raw_phone || '',
    utm_source: r.utm_source || '',
    utm_campaign: r.utm_campaign || '',
    valor,
    meta_status_code: r.meta_status_code,
    meta_response_ok: r.meta_response_ok,
    meta_response_body: r.meta_response_body || '',
  };
}

function descreverFalha(r) {
  let etapa = '', hook = '';
  try {
    const p = JSON.parse(r.request_payload);
    etapa = p.stage || '';
    hook = p.hook || '';
  } catch (_) { /* payload ilegivel: os campos ficam vazios */ }
  return {
    created_at: r.created_at,
    hook,
    etapa,
    person_id: r.person_id,
    deal_id: r.deal_id,
    motivo: r.response_body || '',
  };
}

function clampInt(v, def, min, max) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return def;
  return Math.min(Math.max(n, min), max);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
