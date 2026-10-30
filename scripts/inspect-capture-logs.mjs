const start = process.env.LOG_START;
const end = process.env.LOG_END;
if (!start || !end || !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || Date.parse(end) <= Date.parse(start) || Date.parse(end) - Date.parse(start) > 15 * 60_000) throw new Error('Provide a UTC window of at most fifteen minutes.');
const sql = "select timestamp, source, event_message from logs where source in ('function_edge_logs','function_logs') and (event_message ilike '%capture-sync%' or event_message ilike '%order-code-recovery%') order by timestamp limit 30";
const url = new URL('https://api.supabase.com/v1/projects/jngwzemzllyohrywzxew/analytics/endpoints/logs');
url.searchParams.set('sql', sql); url.searchParams.set('iso_timestamp_start', start); url.searchParams.set('iso_timestamp_end', end);
const response = await fetch(url, { headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}` }, signal: AbortSignal.timeout(45_000) });
if (!response.ok) throw new Error(`Log service returned HTTP ${response.status}`);
const data = await response.json();
if (data.error) throw new Error(String(data.error).slice(0, 600));
// Only the fixed function's invocation/console messages, never metadata or headers.
console.log(JSON.stringify({ responseKeys: Object.keys(data) }));
const rows = data.result || data.data;
if (!Array.isArray(rows)) throw new Error('Unexpected log service result shape');
console.log(JSON.stringify(rows.map(row => ({ timestamp: row.timestamp, source: row.source, event: String(row.event_message || '').slice(0, 500) })), null, 2));
