// GET /api/leads?key=...&days=30&limit=100
// GET /api/leads?key=...&from=2026-09-01&to=2026-09-30&limit=500
//
// Returns Lead events joined to their originating session so each row carries
// its UTMs / fbclid / gclid. This is the "where did my leads come from" view
// — the whole reason the tracking stack persists anything at all.
//
// Source: event_log (Lead events only) LEFT JOIN sessions via session_id.
// Bots are excluded by default; pass include_bots=1 to see them.

export async function onRequestGet(context) {
  const { request, env } = context;

  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  if (!env.DASH_KEY || key !== env.DASH_KEY) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const limit = clampInt(url.searchParams.get('limit'), 100, 1, 500);
  const includeBots = url.searchParams.get('include_bots') === '1';
  const range = resolveRange(url.searchParams);
  if (range.error) return json({ error: range.error }, 400);

  const botClause = includeBots ? '' : 'AND e.is_bot = 0';

  try {
    const rows = await env.DB.prepare(`
      SELECT
        e.event_id,
        e.timestamp,
        e.session_id,
        e.raw_email,
        e.raw_name,
        e.raw_phone,
        e.browser,
        e.os,
        e.is_mobile,
        e.is_bot,
        e.bot_reason,
        e.meta_status_code,
        e.meta_response_ok,
        e.meta_response_body,
        e.meta_payload_sent,
        e.ga4_status_code,
        e.ga4_response_ok,
        e.ga4_response_body,
        e.ga4_payload_sent,
        e.fbp_source,
        e.fbc_source,
        e.fbclid_source,
        s.utm_source,
        s.utm_medium,
        s.utm_campaign,
        s.utm_content,
        s.utm_term,
        s.fbclid,
        s.gclid,
        s.referrer,
        s.landing_url,
        c.ok            AS crm_ok,
        c.status_code   AS crm_status_code,
        c.person_id     AS crm_person_id,
        c.deal_id       AS crm_deal_id,
        c.response_body AS crm_response_body
      FROM event_log e
      LEFT JOIN sessions s ON e.session_id = s.session_id
      -- A ultima tentativa de CRM para este evento. Subquery em vez de join
      -- direto porque um mesmo evento pode ter mais de uma linha em crm_log.
      LEFT JOIN crm_log c ON c.id = (
        SELECT MAX(id) FROM crm_log WHERE event_id = e.event_id
      )
      WHERE e.event_name = 'Lead'
        AND e.timestamp >= ?
        AND e.timestamp < ?
        ${botClause}
      ORDER BY e.timestamp DESC
      LIMIT ?
    `).bind(range.since, range.before, limit).all();

    // Summary counts grouped by utm_source for the summary card above the table.
    const summary = await env.DB.prepare(`
      SELECT
        COALESCE(NULLIF(s.utm_source, ''), '(direct)') as utm_source,
        COUNT(*) as count
      FROM event_log e
      LEFT JOIN sessions s ON e.session_id = s.session_id
      WHERE e.event_name = 'Lead'
        AND e.timestamp >= ?
        AND e.timestamp < ?
        ${botClause}
      GROUP BY utm_source
      ORDER BY count DESC
    `).bind(range.since, range.before).all();

    const summaryRows = summary.results || [];
    const total = summaryRows.reduce((sum, item) => sum + Number(item.count || 0), 0);

    return json({
      days: range.days,
      from: range.from,
      to: range.to,
      total,
      leads: rows.results || [],
      summary: summaryRows,
    });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
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

function clampInt(raw, fallback, min, max) {
  const n = parseInt(raw || '', 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function resolveRange(searchParams) {
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  if (from || to) {
    if (!from || !to) return { error: 'from and to must be provided together' };
    const since = saoPauloMidnight(from);
    const finalDay = saoPauloMidnight(to);
    if (since == null || finalDay == null) return { error: 'from and to must use YYYY-MM-DD' };
    if (since > finalDay) return { error: 'from must be before or equal to to' };
    if ((finalDay - since) / 86400 > 366) return { error: 'date range cannot exceed 367 days' };
    return { since, before: finalDay + 86400, from, to, days: null };
  }

  const days = clampInt(searchParams.get('days'), 30, 1, 365);
  const now = Math.floor(Date.now() / 1000);
  return { since: now - days * 86400, before: now + 1, from: null, to: null, days };
}

function saoPauloMidnight(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return Math.floor(Date.parse(`${value}T00:00:00-03:00`) / 1000);
}
