// Eventos de funil que voltam do CRM para a Meta.
//
// Comeca com "_": modulo, nao rota.
//
// O caminho de ida (site -> Meta) esta no /tracker. Este e o caminho de volta:
// a etapa muda no Agendor, o Agendor chama nosso webhook, e nos reenviamos o
// evento para a Meta amarrado a MESMA visita que originou aquele lead — com o
// fbc, o fbp e o external_id daquele clique no anuncio, semanas antes se for
// o caso. Sem isso a Meta so sabe otimizar por quem preenche formulario, e nao
// por quem vira paciente.
//
// Mapa de etapas (definido com a gestora da clinica):
//
//   Funil Comercial 1 · QUALIFICADO        -> QualifiedLead  (evento customizado)
//   Funil Comercial 2 · CONSULTA AGENDADA  -> Schedule       (evento padrao)
//   Funil Comercial 2 · GANHO              -> Purchase       (evento padrao, com valor)
//
// QualifiedLead e customizado porque a Meta nao tem evento padrao para lead
// qualificado — a lista de 17 padroes vai de AddPaymentInfo a ViewContent e
// nao cobre MQL/SQL. A propria documentacao da CAPI para CRM manda mapear as
// etapas do seu funil em nomes seus. Para otimizar por ele, e preciso criar
// uma conversao personalizada no Gerenciador apontando para este nome.

const META_API = 'https://graph.facebook.com/v25.0';

// Chave = nome da etapa no Agendor, normalizado (maiusculo, sem acento).
const DEFAULT_STAGE_EVENTS = {
  'QUALIFICADO': 'QualifiedLead',
  'CONSULTA AGENDADA': 'Schedule',
  'GANHO': 'Purchase',
};

export async function handleAgendorEvent({ body, hook, env, context }) {
  const deal = body.data || body.deal || body;
  const dealId = deal.id || deal.dealId || null;
  const personId = (deal.person && deal.person.id) || (body.person && body.person.id) || null;
  const stageRaw = (deal.dealStage && deal.dealStage.name)
    || (deal.deal_stage && deal.deal_stage.name)
    || (deal.stage && deal.stage.name)
    || '';
  const value = Number(deal.value || 0);

  // Sempre registra o payload cru, mesmo quando nao ha nada a disparar. E a
  // unica forma de descobrir a forma real do payload do Agendor sem precisar
  // reproduzir um lead, e de auditar depois por que um evento nao saiu.
  const log = async (fields) => {
    if (!env.DB) return;
    try {
      await env.DB.prepare(`
        INSERT INTO crm_log (
          event_id, session_id, provider, created_at,
          status_code, ok, person_id, deal_id, request_payload, response_body
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        fields.eventId || '', fields.sessionId || '', `agendor-webhook:${hook}`,
        Math.floor(Date.now() / 1000),
        fields.status || 0, fields.ok || 0,
        personId ? String(personId) : null, dealId ? String(dealId) : null,
        JSON.stringify({ hook, stage: stageRaw, value, raw: body }).slice(0, 20000),
        (fields.response || '').slice(0, 8000)
      ).run();
    } catch (e) {
      console.error('crm_log webhook error:', e.message);
    }
  };

  // O gatilho on_deal_won nao carrega etapa; ele proprio ja significa a venda.
  const eventName = hook === 'on_deal_won'
    ? 'Purchase'
    : resolveEvent(stageRaw, env);

  if (!eventName) {
    await log({ response: `sem mapeamento para a etapa "${stageRaw}"` });
    return { skipped: 'stage not mapped', stage: stageRaw };
  }

  if (!personId) {
    await log({ response: 'payload sem id de pessoa — impossível achar a sessão' });
    return { skipped: 'no person id' };
  }

  // --- Recupera a visita original ---
  // A busca e por PESSOA, nao por negocio, de proposito: o Comercial 2 pode
  // criar um negocio novo em vez de mover o do Comercial 1, e nesse caso o
  // deal_id nao bate com nada. A pessoa e a mesma nos dois funis.
  const origem = await buscarOrigem(personId, env);
  if (!origem) {
    await log({ response: `pessoa ${personId} não veio do site — nada a atribuir` });
    return { skipped: 'person not from site' };
  }

  // event_id deterministico: se o negocio for arrastado para a mesma etapa
  // duas vezes, a Meta recebe o mesmo id e conta uma vez so.
  const eventId = `agendor-${dealId || personId}-${eventName}`;

  const jaEnviado = await env.DB.prepare(
    'SELECT 1 FROM event_log WHERE event_id = ? LIMIT 1'
  ).bind(eventId).first().catch(() => null);
  if (jaEnviado) {
    await log({ eventId, sessionId: origem.session_id, response: 'já enviado antes' });
    return { skipped: 'duplicate', eventId };
  }

  const enviado = await enviarParaMeta({ eventName, eventId, value, origem, env });

  context.waitUntil(Promise.all([
    log({
      eventId,
      sessionId: origem.session_id,
      status: enviado.status,
      ok: enviado.ok,
      response: enviado.body,
    }),
    registrarNoEventLog({ eventName, eventId, origem, enviado, env }),
  ]));

  return { sent: eventName, eventId, status: enviado.status };
}

function resolveEvent(stageName, env) {
  let mapa = DEFAULT_STAGE_EVENTS;
  if (env.AGENDOR_STAGE_EVENTS) {
    try {
      mapa = { ...DEFAULT_STAGE_EVENTS, ...JSON.parse(env.AGENDOR_STAGE_EVENTS) };
    } catch (_) { /* mapa customizado invalido: fica com o padrao */ }
  }
  const chave = normalizar(stageName);
  for (const [etapa, evento] of Object.entries(mapa)) {
    if (normalizar(etapa) === chave) return evento;
  }
  return null;
}

// "Consulta Agendada" e "CONSULTA AGENDADA" tem de bater com a mesma chave, e
// alguem vai renomear a etapa com acento uma hora.
function normalizar(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim().toUpperCase().replace(/\s+/g, ' ');
}

// Junta a sessao original (fbc/fbp/UTMs) com o PII cru do Lead que gerou
// aquela pessoa no CRM.
async function buscarOrigem(personId, env) {
  if (!env.DB) return null;
  try {
    return await env.DB.prepare(`
      SELECT
        s.session_id, s.external_id, s.fbc, s.fbp, s.ip_address, s.user_agent,
        s.landing_url, s.utm_source, s.utm_campaign,
        e.raw_email, e.raw_name, e.raw_phone
      FROM crm_log c
      JOIN sessions s  ON s.session_id = c.session_id
      LEFT JOIN event_log e ON e.event_id = c.event_id
      WHERE c.person_id = ? AND c.provider = 'agendor'
      ORDER BY c.id DESC
      LIMIT 1
    `).bind(String(personId)).first();
  } catch (e) {
    console.error('lookup origem error:', e.message);
    return null;
  }
}

async function enviarParaMeta({ eventName, eventId, value, origem, env }) {
  if (!env.META_PIXEL_ID || !env.META_ACCESS_TOKEN) {
    return { ok: 0, status: 0, body: 'skipped: missing meta env', payload: null };
  }

  const partes = (origem.raw_name || '').trim().split(/\s+/);
  const userData = {
    client_ip_address: origem.ip_address || '',
    client_user_agent: origem.user_agent || '',
  };

  const em = await sha256(origem.raw_email);
  const ph = await sha256(normalizarTelefone(origem.raw_phone, env.DEFAULT_COUNTRY_CODE));
  const fn = await sha256((partes[0] || '').toLowerCase());
  const ln = await sha256(partes.slice(1).join(' ').toLowerCase());
  const eid = await sha256(origem.external_id);

  if (em) userData.em = [em];
  if (ph) userData.ph = [ph];
  if (fn) userData.fn = [fn];
  if (ln) userData.ln = [ln];
  if (eid) userData.external_id = [eid];
  if (origem.fbp) userData.fbp = origem.fbp;
  if (origem.fbc) userData.fbc = origem.fbc;

  const evento = {
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    event_id: eventId,
    event_source_url: origem.landing_url || '',
    // Nao foi o navegador que disparou — foi a equipe movendo o card no CRM.
    action_source: 'system_generated',
    user_data: userData,
  };

  if (eventName === 'Purchase') {
    evento.custom_data = { currency: 'BRL', value: value > 0 ? value : 0 };
  }

  const payload = { data: [evento] };
  if (env.META_TEST_EVENT_CODE) payload.test_event_code = env.META_TEST_EVENT_CODE;

  try {
    const r = await fetch(
      `${META_API}/${env.META_PIXEL_ID}/events?access_token=${env.META_ACCESS_TOKEN}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
    );
    const body = await r.text();
    return { ok: r.ok ? 1 : 0, status: r.status, body, payload: JSON.stringify(payload) };
  } catch (e) {
    return { ok: 0, status: 0, body: `fetch error: ${e.message}`, payload: JSON.stringify(payload) };
  }
}

// Grava na mesma tabela dos eventos do site para que o /dash e a secao de
// saude do tracking enxerguem o funil inteiro, e nao so a metade de cima.
async function registrarNoEventLog({ eventName, eventId, origem, enviado, env }) {
  if (!env.DB) return;
  try {
    await env.DB.prepare(`
      INSERT INTO event_log (
        session_id, event_name, event_id, timestamp,
        is_bot, consent_status,
        sent_to_meta, meta_status_code, meta_response_ok, meta_response_body, meta_payload_sent,
        has_email, has_phone, has_name,
        raw_email, raw_name, raw_phone
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      origem.session_id, eventName, eventId, Math.floor(Date.now() / 1000),
      0, 'crm',
      1, enviado.status, enviado.ok, enviado.body, enviado.payload,
      origem.raw_email ? 1 : 0, origem.raw_phone ? 1 : 0, origem.raw_name ? 1 : 0,
      origem.raw_email || '', origem.raw_name || '', origem.raw_phone || ''
    ).run();
  } catch (e) {
    console.error('event_log CRM error:', e.message);
  }
}

async function sha256(value) {
  if (!value) return '';
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value).toLowerCase().trim()));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Mesma regra do /tracker: a Meta exige DDI + DDD nos digitos antes do hash.
function normalizarTelefone(ph, countryCode) {
  if (!ph) return '';
  const cc = String(countryCode || '55');
  const d = String(ph).replace(/\D/g, '').replace(/^0+/, '');
  if (!d) return '';
  if (d.startsWith(cc) && d.length >= cc.length + 8 && d.length <= cc.length + 11) return d;
  if (d.length >= 8 && d.length <= 11) return cc + d;
  return d;
}
