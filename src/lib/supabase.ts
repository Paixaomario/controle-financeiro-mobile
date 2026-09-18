import { createClient } from '@supabase/supabase-js';

/**
 * A "anon public key" do Supabase é feita para ser exposta no cliente —
 * é assim que o Supabase funciona por design (a segurança real vem das
 * políticas de Row Level Security no banco, não do sigilo desta chave).
 * Por isso ela pode ficar aqui, com valor padrão, garantindo que o
 * frontend funcione no Vercel sem exigir nenhuma variável de ambiente
 * configurada manualmente no painel.
 *
 * Se algum dia você quiser sobrescrever (ex: apontar para outro projeto
 * Supabase), basta definir VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
 * nas variáveis de ambiente do Vercel — elas têm prioridade sobre o
 * valor padrão abaixo.
 */
const DEFAULT_SUPABASE_URL = 'https://kgtyfgiuyakixcuagdby.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtndHlmZ2l1eWFraXhjdWFnZGJ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcwMzA5ODYsImV4cCI6MjEwMjYwNjk4Nn0.tLhPMf5N_YeO1MbloGB6tgJTQaPUHXz9YTwCQtznlDI';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Garante que existe uma linha em `app_user` vinculada ao usuário Supabase
 * Auth logado. Chamado uma vez após login — todo o resto do app (RLS
 * incluso) depende de `app_user.auth_user_id` existir.
 */
export async function ensureAppUser(): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Usuário não autenticado');

  const { data: existing } = await supabase.from('app_user').select('id').eq('auth_user_id', user.id).maybeSingle();
  if (existing) return existing.id;

  const { data: created, error } = await supabase
    .from('app_user')
    .insert({ auth_user_id: user.id, email: user.email })
    .select('id')
    .single();

  if (error) {
    // Condição de corrida: duas chamadas simultâneas tentaram criar o
    // mesmo perfil ao mesmo tempo (comum ao carregar a página) — a que
    // perdeu a corrida só precisa buscar o registro que a outra já criou,
    // em vez de propagar o erro de chave duplicada.
    if (error.code === '23505') {
      const { data: retryExisting, error: retryError } = await supabase
        .from('app_user')
        .select('id')
        .eq('auth_user_id', user.id)
        .single();
      if (retryError) throw retryError;
      return retryExisting.id;
    }
    throw error;
  }

  try {
    await supabase.rpc('seed_default_categories', { p_user_id: created.id });
  } catch {
    // função ainda não existe em bancos antigos; ignora silenciosamente
  }

  return created.id;
}
