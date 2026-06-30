import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // No lanzamos en build; avisamos en runtime del cliente.
  // eslint-disable-next-line no-console
  console.warn(
    "[supabase] Falta NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY en .env.local"
  );
}

/**
 * Cliente Supabase de SOLO LECTURA (anon key).
 * Nunca uses la service_role key en el frontend.
 */
export const supabase = createClient(url ?? "", anonKey ?? "", {
  auth: { persistSession: false },
  realtime: { params: { eventsPerSecond: 2 } },
});

export const SUPABASE_READY = Boolean(url && anonKey);
