// GET /api/contacts?key=...&days=30&limit=100
//
// The site uses Meta's standard `Contact` event for WhatsApp clicks. The
// generic stack's leads endpoint only reports `Lead`, which is correct for a
// form funnel but hid this site's primary conversion from the dashboard.
// This endpoint keeps both semantics: Contact remains Contact for ad
// platforms, while the dashboard receives a dedicated contact-click view.

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const key = url.searchParams.get('key');

  if (!env.DASH_KEY || key !== env.DASH_KEY) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const days = clampInt(url.searchParams.get('days'), 30, 1, 365);
  const limit = clampInt(url.searchParams.get('limit'), 100, 1, 500);
  const since = Math.floor(Date.now() / 1000) - (days * 86400);

  try {
    const contactFilter = `
      e.event_name IN ('Contact', 'site_whatsapp_click', 'bio_whatsapp_click')
      AND e.is_bot = 0
      AND e.timestamp >= ?
    `;

    const rows = await env.DB.prepare(`
      SELECT
        e.event_id,
        e.event_name,
        e.timestamp,
        e.session_id,
        e.browser,
        e.os,
        e.is_mobile,
        e.meta_status_code,
        e.meta_response_ok,
        e.meta_response_body,
        e.meta_payload_sent,
        e.ga4_status_code,
        e.ga4_response_ok,
        e.ga4_response_body,
        e.ga4_payload_sent,
        s.utm_source,
        s.utm_medium,
        s.utm_campaign,
        s.utm_content,
        s.utm_term,
        CASE
          WHEN COALESCE(s.gclid, '') != '' THEN 'gclid'
          WHEN COALESCE(s.wbraid, '') != '' THEN 'wbraid'
          WHEN COALESCE(s.gbraid, '') != '' THEN 'gbraid'
          ELSE ''
        END AS google_id_type,
        CASE
          WHEN e.event_name = 'bio_whatsapp_click'
            OR LOWER(COALESCE(s.landing_url, '')) LIKE '%/bio%'
            OR LOWER(COALESCE(s.landing_url, '')) LIKE '%links.dravictorialacerda.com.br%'
            OR LOWER(COALESCE(s.landing_url, '')) LIKE '%bio.dravictorialacerda.com.br%'
          THEN 'Link da bio'
          WHEN LOWER(COALESCE(s.landing_url, '')) LIKE '%/google%'
          THEN 'Página Google'
          ELSE 'Site principal'
        END AS surface
      FROM event_log e
      LEFT JOIN sessions s ON s.session_id = e.session_id
      WHERE ${contactFilter}
      ORDER BY e.timestamp DESC
      LIMIT ?
    `).bind(since, limit).all();

    const summary = await env.DB.prepare(`
      SELECT
        COUNT(*) AS total,
        COUNT(DISTINCT NULLIF(e.session_id, '')) AS people,
        SUM(CASE WHEN e.is_mobile = 1 THEN 1 ELSE 0 END) AS mobile_clicks,
        SUM(CASE WHEN e.meta_response_ok = 1 THEN 1 ELSE 0 END) AS meta_ok,
        SUM(CASE WHEN e.ga4_response_ok = 1 THEN 1 ELSE 0 END) AS ga4_ok,
        SUM(CASE WHEN COALESCE(s.gclid, '') != '' OR COALESCE(s.gbraid, '') != '' OR COALESCE(s.wbraid, '') != '' THEN 1 ELSE 0 END) AS google_attributed,
        SUM(CASE
          WHEN e.event_name = 'bio_whatsapp_click'
            OR LOWER(COALESCE(s.landing_url, '')) LIKE '%/bio%'
            OR LOWER(COALESCE(s.landing_url, '')) LIKE '%links.dravictorialacerda.com.br%'
            OR LOWER(COALESCE(s.landing_url, '')) LIKE '%bio.dravictorialacerda.com.br%'
          THEN 1 ELSE 0 END) AS bio_clicks
      FROM event_log e
      LEFT JOIN sessions s ON s.session_id = e.session_id
      WHERE ${contactFilter}
    `).bind(since).first();

    return json({
      days,
      total: Number(summary?.total || 0),
      people: Number(summary?.people || 0),
      mobile_clicks: Number(summary?.mobile_clicks || 0),
      meta_ok: Number(summary?.meta_ok || 0),
      ga4_ok: Number(summary?.ga4_ok || 0),
      google_attributed: Number(summary?.google_attributed || 0),
      bio_clicks: Number(summary?.bio_clicks || 0),
      contacts: rows.results || [],
    });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
}

function clampInt(raw, fallback, min, max) {
  const value = parseInt(raw || '', 10);
  if (Number.isNaN(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
