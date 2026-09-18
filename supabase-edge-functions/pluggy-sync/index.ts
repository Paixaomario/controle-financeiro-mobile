// Edge Function: pluggy-sync
// Agente de Sincronização Bancária — conecta ao Open Finance via Pluggy
// e importa contas/extratos automaticamente, sem SMS e sem digitação.
//
// Segredos necessários (Supabase → Edge Functions → Secrets):
//   PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET
//
// action:
//   add-connection → salva o Item ID de uma conta conectada no Meu Pluggy
//   sync           → busca contas + extrato de todas as conexões do usuário
//   list           → lista as conexões já salvas

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const PLUGGY_BASE_URL = 'https://api.pluggy.ai';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function normalizeMerchant(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\d{2,}/g, '')
    .trim();
}

/** Converte reais (número, vindo da Pluggy) para centavos inteiros — único ponto de arredondamento permitido, na borda com um dado externo em ponto flutuante. */
function reaisToCents(amount: number): bigint {
  return BigInt(Math.round(Math.abs(amount) * 100));
}

async function getPluggyApiKey(): Promise<string> {
  const clientId = Deno.env.get('PLUGGY_CLIENT_ID');
  const clientSecret = Deno.env.get('PLUGGY_CLIENT_SECRET');
  if (!clientId || !clientSecret) {
    throw new Error('PLUGGY_CLIENT_ID/PLUGGY_CLIENT_SECRET não configurados no Supabase.');
  }

  const response = await fetch(`${PLUGGY_BASE_URL}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, clientSecret }),
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Falha ao autenticar na Pluggy (${response.status}): ${errText}`);
  }
  const data = await response.json();
  return data.apiKey;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ error: 'Não autenticado' }, 401);

  const { data: appUser } = await supabase.from('app_user').select('id').eq('auth_user_id', user.id).single();
  if (!appUser) return json({ error: 'Perfil não encontrado' }, 404);
  const userId = appUser.id;

  try {
    const { action, payload } = await req.json();

    if (action === 'create-connect-token') {
      const apiKey = await getPluggyApiKey();
      const response = await fetch(`${PLUGGY_BASE_URL}/connect_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
        body: JSON.stringify({ options: { clientUserId: userId, avoidDuplicates: true } }),
      });
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Falha ao gerar connect token na Pluggy (${response.status}): ${errText}`);
      }
      const data = await response.json();
      return json({ accessToken: data.accessToken });
    }

    if (action === 'add-connection') {
      const { data, error } = await supabase
        .from('bank_connection')
        .insert({ user_id: userId, item_id: payload.itemId })
        .select()
        .single();
      if (error) throw error;
      return json(data);
    }

    if (action === 'list') {
      const { data } = await supabase
        .from('bank_connection')
        .select('id, item_id, institution_name, last_synced_at')
        .eq('user_id', userId);
      return json(data ?? []);
    }

    if (action === 'sync') {
      const { data: connections } = await supabase.from('bank_connection').select('*').eq('user_id', userId);
      if (!connections?.length) return json({ error: 'Nenhuma conexão bancária cadastrada ainda.' }, 400);

      const apiKey = await getPluggyApiKey();
      const results = [];

      for (const conn of connections) {
        results.push(await syncConnection(supabase, userId, conn, apiKey));
      }

      return json({ synced: results.length, results });
    }

    return json({ error: `Ação desconhecida: ${action}` }, 400);
  } catch (err) {
    return json({ error: (err as Error).message }, 400);
  }
});

async function syncConnection(supabase: any, userId: string, connection: any, apiKey: string) {
  // Verifica o status real da conexão antes de tentar puxar dados — uma
  // sincronização recém-criada pode ainda estar processando do lado do
  // banco (Open Finance não é instantâneo na primeira vez).
  const itemRes = await fetch(`${PLUGGY_BASE_URL}/items/${connection.item_id}`, {
    headers: { 'X-API-KEY': apiKey },
  });
  if (!itemRes.ok) throw new Error(`Falha ao consultar status da conexão: ${itemRes.status}`);
  const item = await itemRes.json();

  if (item.status === 'UPDATING') {
    return {
      itemId: connection.item_id,
      institutionName: connection.institution_name,
      status: 'UPDATING',
      message: 'A conexão ainda está sincronizando do lado do banco — tente novamente em alguns instantes.',
      accountsFound: 0,
      transactionsImported: 0,
    };
  }
  if (item.status === 'LOGIN_ERROR') {
    throw new Error(
      `A conexão precisa ser refeita (${item.executionStatus ?? 'erro de login'}): ${item.error?.message ?? 'sem detalhes'}`,
    );
  }

  const accountsRes = await fetch(`${PLUGGY_BASE_URL}/accounts?itemId=${connection.item_id}`, {
    headers: { 'X-API-KEY': apiKey },
  });
  if (!accountsRes.ok) throw new Error(`Falha ao buscar contas (item ${connection.item_id}): ${accountsRes.status}`);
  const accountsData = await accountsRes.json();
  const pluggyAccounts = accountsData.results ?? [];

  let institutionName: string | null = null;
  let transactionsImported = 0;

  for (const pAccount of pluggyAccounts) {
    institutionName = pAccount.owner ?? institutionName;

    // upsert da conta local, vinculada ao id da Pluggy
    const { data: localAccount } = await supabase
      .from('account')
      .upsert(
        {
          user_id: userId,
          pluggy_account_id: pAccount.id,
          name: pAccount.name ?? 'Conta',
          institution: pAccount.marketingName ?? institutionName,
          type: pAccount.type ?? 'BANK',
          balance_cents: reaisToCents(pAccount.balance ?? 0),
        },
        { onConflict: 'user_id,pluggy_account_id' },
      )
      .select('id')
      .single();

    if (!localAccount) continue;

    // busca as transações dos últimos 90 dias (ou desde a última sincronização, o que for mais recente)
    const from = connection.last_synced_at
      ? new Date(connection.last_synced_at).toISOString().slice(0, 10)
      : new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);

    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const txRes = await fetch(
        `${PLUGGY_BASE_URL}/transactions?accountId=${pAccount.id}&from=${from}&pageSize=200&page=${page}`,
        { headers: { 'X-API-KEY': apiKey } },
      );
      if (!txRes.ok) throw new Error(`Falha ao buscar extrato: ${txRes.status}`);
      const txData = await txRes.json();
      const pluggyTxs = txData.results ?? [];

      for (const tx of pluggyTxs) {
        const merchantName: string = tx.merchant?.name ?? tx.description ?? 'Transação';
        const type = tx.type === 'CREDIT' ? 'INCOME' : 'EXPENSE';
        const amountCents = reaisToCents(tx.amount);

        // Agente de Categorização Inteligente: usa memória já aprendida, se existir
        let categoryId: string | null = null;
        const { data: mapped } = await supabase
          .from('merchant_category_map')
          .select('category_id')
          .eq('user_id', userId)
          .eq('merchant_pattern', normalizeMerchant(merchantName))
          .maybeSingle();
        if (mapped) categoryId = mapped.category_id;

        const { error: insertError } = await supabase.from('transaction').upsert(
          {
            user_id: userId,
            type,
            amount_cents: amountCents,
            occurred_at: tx.date,
            account_id: localAccount.id,
            category_id: categoryId,
            merchant_name: merchantName,
            source: 'OPEN_FINANCE',
            external_id: tx.id,
          },
          { onConflict: 'user_id,external_id' },
        );
        if (!insertError) transactionsImported++;
      }

      hasMore = pluggyTxs.length === 200;
      page++;
    }
  }

  await supabase
    .from('bank_connection')
    .update({ institution_name: institutionName, last_synced_at: new Date().toISOString() })
    .eq('id', connection.id);

  return {
    itemId: connection.item_id,
    institutionName,
    status: item.status,
    accountsFound: pluggyAccounts.length,
    transactionsImported,
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
