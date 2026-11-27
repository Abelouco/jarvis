import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { JarvisEvent } from './types';

export const SUPABASE_URL = 'https://pmqxeikcnuywvcxkeoep.supabase.co';
/** Chave publicável: feita para ficar no app; quem protege os dados é o RLS. */
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ieoMb7lkKpizx6oTkmKNnQ_7NfLo05q';
export const FUSO = 'America/Sao_Paulo';

/** Armazenamento de sessão no formato do AsyncStorage/localStorage. */
export interface ArmazenamentoSessao {
  getItem(chave: string): string | null | Promise<string | null>;
  setItem(chave: string, valor: string): void | Promise<void>;
  removeItem(chave: string): void | Promise<void>;
}

/** Cada app passa o armazenamento de sessão dele. */
export function criarCliente(storage?: ArmazenamentoSessao): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { storage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
}

/** Escuta a tabela `events` em tempo real (alimenta o sync e o cérebro). */
export function ouvirEventos(sb: SupabaseClient, aoChegar: (e: JarvisEvent) => void) {
  return sb
    .channel(`events-${crypto.randomUUID()}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'events' }, (m) =>
      aoChegar(m.new as JarvisEvent),
    )
    .subscribe();
}
