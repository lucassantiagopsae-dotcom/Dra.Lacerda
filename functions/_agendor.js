// Envio do lead para o CRM Agendor.
//
// Este arquivo comeca com "_", entao o Pages NAO cria rota para ele — e um
// modulo importado pelo /tracker, nao um endpoint publico.
//
// Fluxo, na ordem:
//   1. POST /v3/people/upsert   -> cria ou atualiza a pessoa (dedupe por email)
//   2. POST /v3/people/{id}/deals -> cria o negocio no funil, com a origem
//      completa na descricao
//
// A origem (UTMs, fbclid, referrer, landing page) vai no CAMPO DE DESCRICAO do
// negocio de proposito: e o unico lugar que funciona sem a cliente precisar
// criar campos customizados no Agendor antes. Quando ela criar os campos, basta
// mapear em AGENDOR_CUSTOM_FIELDS (ver montarCustomFields abaixo) que os mesmos
// dados passam a ir tambem estruturados, sem perder a descricao.
//
// Tudo — payload enviado e resposta recebida — e gravado em crm_log. Sem isso
// uma falha do CRM seria invisivel: o lead ja foi pro WhatsApp e ninguem
// perceberia que ele nao entrou no funil.

const API = 'https://api.agendor.com.br/v3';

export async function sendLeadToAgendor({ lead, session, eventId, sessionId, env, db }) {
  if (!env.AGENDOR_TOKEN) {
    return { skipped: 'missing AGENDOR_TOKEN' };
  }

  const headers = {
    'Authorization': `Token ${env.AGENDOR_TOKEN}`,
    'Content-Type': 'application/json',
  };

  const origem = montarOrigem({ session, eventId, sessionId });

  // ---------- 1. pessoa ----------
  const pessoa = { name: lead.name || 'Lead sem nome' };
  const contact = {};
  if (lead.email) contact.email = lead.email;
  if (lead.phone) contact.mobile = lead.phone;
  if (Object.keys(contact).length) pessoa.contact = contact;

  const customFields = montarCustomFields(session, env);
  if (customFields) pessoa.customFields = customFields;

  let personId = null;
  let personStatus = 0;
  let personBody = '';

  try {
    const r = await fetch(`${API}/people/upsert`, {
      method: 'POST',
      headers,
      body: JSON.stringify(pessoa),
    });
    personStatus = r.status;
    personBody = await r.text();
    personId = extrairId(personBody);
  } catch (e) {
    personBody = `fetch error: ${e.message}`;
  }

  // ---------- 2. negocio ----------
  // Sem pessoa nao ha o que anexar; para a pessoa ja ter sido criada, isso e
  // uma falha parcial e nao total — por isso o log guarda os dois status.
  let dealId = null;
  let dealStatus = 0;
  let dealBody = '';

  if (personId && env.AGENDOR_CREATE_DEAL !== 'false') {
    const negocio = {
      title: `${env.AGENDOR_DEAL_TITLE || 'Lead do site'} — ${lead.name || 'sem nome'}`,
      description: origem,
    };
    if (env.AGENDOR_DEAL_STAGE) negocio.dealStage = Number(env.AGENDOR_DEAL_STAGE);
    if (env.AGENDOR_FUNNEL_ID) negocio.funnel = Number(env.AGENDOR_FUNNEL_ID);

    try {
      let r = await fetch(`${API}/people/${personId}/deals`, {
        method: 'POST',
        headers,
        body: JSON.stringify(negocio),
      });

      // A doc publica so exemplifica o caminho aninhado em /organizations.
      // Se o equivalente em /people nao existir, cai para a rota plana com o
      // id da pessoa no corpo, que e a forma documentada na v1/v2.
      if (r.status === 404 || r.status === 405) {
        r = await fetch(`${API}/deals`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ ...negocio, person: personId }),
        });
      }

      dealStatus = r.status;
      dealBody = await r.text();
      dealId = extrairId(dealBody);
    } catch (e) {
      dealBody = `fetch error: ${e.message}`;
    }
  }

  const ok = personStatus >= 200 && personStatus < 300 ? 1 : 0;

  // ---------- 3. log ----------
  if (db) {
    try {
      await db.prepare(`
        INSERT INTO crm_log (
          event_id, session_id, provider, created_at,
          status_code, ok, person_id, deal_id,
          request_payload, response_body
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        eventId || '', sessionId || '', 'agendor', Math.floor(Date.now() / 1000),
        personStatus, ok, personId ? String(personId) : null, dealId ? String(dealId) : null,
        JSON.stringify({ person: pessoa, dealDescription: origem }),
        JSON.stringify({ personStatus, personBody, dealStatus, dealBody })
      ).run();
    } catch (e) {
      console.error('crm_log error:', e.message);
    }
  }

  return { ok, personId, dealId, personStatus, dealStatus };
}

// A descricao que a equipe vai ler dentro do negocio no Agendor. Texto puro de
// proposito: o campo nao renderiza markdown.
function montarOrigem({ session, eventId, sessionId }) {
  const s = session || {};
  const linha = (rotulo, valor) => (valor ? `${rotulo}: ${valor}\n` : '');

  return 'Lead capturado no site\n\n'
    + linha('Origem', s.utm_source || '(direto)')
    + linha('Midia', s.utm_medium)
    + linha('Campanha', s.utm_campaign)
    + linha('Conteudo', s.utm_content)
    + linha('Termo', s.utm_term)
    + '\n'
    + linha('Pagina de entrada', s.landing_url)
    + linha('Referrer', s.referrer)
    + linha('fbclid', s.fbclid)
    + linha('gclid', s.gclid)
    + '\n'
    + linha('session_id', sessionId)
    + linha('event_id', eventId);
}

// Mapeamento opcional para campos customizados do Agendor, no formato
//   AGENDOR_CUSTOM_FIELDS = {"utm_source":"origem","utm_campaign":"campanha"}
// onde a chave e o campo da sessao e o valor e a coluna identificadora do
// campo customizado la no Agendor. Sem a variavel, nada e enviado — campo
// customizado inexistente faz o Agendor recusar o registro inteiro.
function montarCustomFields(session, env) {
  if (!env.AGENDOR_CUSTOM_FIELDS) return null;
  try {
    const mapa = JSON.parse(env.AGENDOR_CUSTOM_FIELDS);
    const out = {};
    for (const [campoSessao, colunaAgendor] of Object.entries(mapa)) {
      const valor = (session || {})[campoSessao];
      if (valor) out[colunaAgendor] = valor;
    }
    return Object.keys(out).length ? out : null;
  } catch (_) {
    return null;
  }
}

// A v3 responde ora { data: { id } }, ora o objeto direto.
function extrairId(text) {
  try {
    const j = JSON.parse(text);
    return (j && j.data && j.data.id) || (j && j.id) || null;
  } catch (_) {
    return null;
  }
}
