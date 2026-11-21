import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const SUPABASE_URL = 'https://pmqxeikcnuywvcxkeoep.supabase.co';
export const FUSO = 'America/Sao_Paulo';

/** Cada app passa a chave anon e o armazenamento de sessão dele. */
export function criarCliente(anonKey: string, storage?: unknown): SupabaseClient {
  return createClient(SUPABASE_URL, anonKey, {
    auth: { storage: storage as never, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
}

/** Escuta a tabela `events` em tempo real (alimenta o cérebro). */
export function ouvirEventos(sb: SupabaseClient, aoChegar: (e: import('./types').JarvisEvent) => void) {
  return sb
    .channel('events')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'events' }, (m) => aoChegar(m.new as never))
    .subscribe();
}
