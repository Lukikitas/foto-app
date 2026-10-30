import { createClient } from '@supabase/supabase-js';
import { createBoundedFetch } from './boundedFetch.js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: createBoundedFetch() },
});
const requestClients = new WeakMap();

export function supabaseForSignal(signal) {
  if (!signal) return supabase;
  if (requestClients.has(signal)) return requestClients.get(signal);
  const bounded = createBoundedFetch();
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    // External accessToken mode avoids creating an Auth client (and a permanent
    // browser visibility listener) for every queued capture. Reuse the one
    // session owned by the app and collect request clients with their signals.
    accessToken: async () => (await supabase.auth.getSession()).data.session?.access_token || supabaseAnonKey,
    global: { fetch: (input, options) => bounded(input, { ...options, signal }) },
  });
  requestClients.set(signal, client);
  return client;
}
