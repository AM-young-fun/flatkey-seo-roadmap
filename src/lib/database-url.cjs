/* global URL, module */

/**
 * Keep serverless PostgreSQL clients within the transaction pool. Only the
 * documented Supabase pooler host/port pair is rewritten; direct database
 * hosts and other providers keep their original endpoint and parameters.
 */
function buildDatabaseUrl(raw, serverless) {
  const url = new URL(raw);
  const supabasePooler = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+pooler\.supabase\.com$/i.test(url.hostname);
  if (serverless && supabasePooler && (!url.port || url.port === "5432")) {
    url.port = "6543";
  }
  if (supabasePooler && url.port === "6543") {
    url.searchParams.set("pgbouncer", "true");
  }
  if (serverless) {
    url.searchParams.set("connection_limit", "1");
  } else if (!url.searchParams.has("connection_limit")) {
    url.searchParams.set("connection_limit", "3");
  }
  if (!url.searchParams.has("connect_timeout")) url.searchParams.set("connect_timeout", "20");
  if (!url.searchParams.has("pool_timeout")) url.searchParams.set("pool_timeout", "20");
  return url.toString();
}

module.exports = { buildDatabaseUrl };
