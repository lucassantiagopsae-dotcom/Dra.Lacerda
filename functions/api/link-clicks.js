export async function onRequestGet(context) {
  const { request, env } = context;
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };
  const url = new URL(request.url);
  const key = url.searchParams.get('key');

  if (!env.DASH_KEY || key !== env.DASH_KEY) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
  }

  const days = Math.min(Math.max(parseInt(url.searchParams.get('days') || '30', 10), 1), 365);
  const since = Math.floor(Date.now() / 1000) - (days * 86400);

  try {
    const { results } = await env.DB.prepare(`
      WITH bio_events AS (
        SELECT
          CASE
            WHEN e.event_name = 'Contact' THEN 'bio_whatsapp_click'
            ELSE e.event_name
          END AS event_name,
          e.session_id,
          e.is_mobile,
          e.meta_response_ok
        FROM event_log e
        LEFT JOIN sessions s ON s.session_id = e.session_id
        WHERE e.timestamp >= ?
          AND e.is_bot = 0
          AND (
            e.event_name IN ('bio_whatsapp_click', 'bio_slim_balance_click', 'bio_maps_click')
            OR (
              e.event_name = 'Contact'
              AND (
                LOWER(COALESCE(s.landing_url, '')) LIKE '%/bio%'
                OR LOWER(COALESCE(s.landing_url, '')) LIKE '%links.dravictorialacerda.com.br%'
                OR LOWER(COALESCE(s.landing_url, '')) LIKE '%bio.dravictorialacerda.com.br%'
              )
            )
          )
      )
      SELECT
        event_name,
        COUNT(*) AS clicks,
        COUNT(DISTINCT NULLIF(session_id, '')) AS people,
        SUM(CASE WHEN is_mobile = 1 THEN 1 ELSE 0 END) AS mobile_clicks,
        SUM(CASE WHEN meta_response_ok = 1 THEN 1 ELSE 0 END) AS meta_ok
      FROM bio_events
      GROUP BY event_name
      ORDER BY clicks DESC
    `).bind(since).all();

    const events = {
      bio_whatsapp_click: emptyMetric(),
      bio_slim_balance_click: emptyMetric(),
      bio_maps_click: emptyMetric(),
    };

    for (const row of results || []) {
      if (!events[row.event_name]) continue;
      events[row.event_name] = {
        clicks: Number(row.clicks || 0),
        people: Number(row.people || 0),
        mobile_clicks: Number(row.mobile_clicks || 0),
        meta_ok: Number(row.meta_ok || 0),
      };
    }

    const total_clicks = Object.values(events).reduce((sum, item) => sum + item.clicks, 0);
    return new Response(JSON.stringify({ days, total_clicks, events }), { status: 200, headers });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
}

function emptyMetric() {
  return { clicks: 0, people: 0, mobile_clicks: 0, meta_ok: 0 };
}
