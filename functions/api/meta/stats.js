// Diagnostico do pixel direto na Graph API.
//
//   GET /api/meta/stats?key=<DASH_KEY>&days=7
//
// Existe porque o Gerenciador de Eventos so abre para quem esta dentro do
// portfolio dono do pixel — quem tem acesso de parceiro pela conta de anuncios
// recebe "Ocorreu um erro" e nao consegue verificar nada. Este endpoint
// pergunta a mesma coisa a Meta usando o token que ja vive no Worker, entao
// ninguem precisa manusear a credencial nem depender da interface.
//
// Devolve as respostas cruas de proposito: quando algo esta errado, a mensagem
// da Meta e mais util do que qualquer resumo que a gente inventasse.

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (!env.DASH_KEY || url.searchParams.get('key') !== env.DASH_KEY) {
    return json({ error: 'Unauthorized' }, 401);
  }
  if (!env.META_PIXEL_ID || !env.META_ACCESS_TOKEN) {
    return json({ error: 'META_PIXEL_ID ou META_ACCESS_TOKEN nao configurados' }, 400);
  }

  const dias = Math.min(Math.max(parseInt(url.searchParams.get('days') || '7', 10), 1), 30);
  const desde = Math.floor(Date.now() / 1000) - dias * 86400;
  const base = `https://graph.facebook.com/v25.0/${env.META_PIXEL_ID}`;
  const token = `access_token=${env.META_ACCESS_TOKEN}`;

  const pixel = await pegar(`${base}?fields=id,name,last_fired_time,is_unavailable,owner_business{id,name}&${token}`);

  // Contagem por nome de evento na janela pedida. Confirma que QualifiedLead,
  // Schedule e Purchase existem do lado da Meta, e nao so na nossa resposta 200.
  const porEvento = await pegar(
    `${base}/stats?aggregation=event&start_time=${desde}&${token}`
  );

  return json({
    pixel_id: env.META_PIXEL_ID,
    janela_dias: dias,
    pixel,
    eventos: porEvento,
  });
}

async function pegar(url) {
  try {
    const r = await fetch(url);
    const texto = await r.text();
    try { return { status: r.status, body: JSON.parse(texto) }; }
    catch (_) { return { status: r.status, body: texto }; }
  } catch (e) {
    return { status: 0, body: `fetch error: ${e.message}` };
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
