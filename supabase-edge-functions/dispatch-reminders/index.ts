// Edge Function: dispatch-reminders
// Invocada por pg_cron a cada minuto (via pg_net). Varre payment_reminder
// com scheduled_for no passado e status PENDING, envia Web Push para
// todas as inscrições do usuário, e marca como SENT.
//
// Requer o secret VAPID_PRIVATE_KEY configurado no projeto (Supabase
// Dashboard → Edge Functions → Manage secrets) — é a ÚNICA configuração
// manual que não dá pra automatizar, porque é uma chave privada de
// verdade (nenhum provedor de Web Push escapa disso).

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';

const VAPID_PUBLIC_KEY = 'BJf0Z3M9u181D433RThotwg9xA5q5HdgWwhWZuK3hHXHxCOQSYMHtGmkv8Qc9HVlZEITF4etSxHFqVKWvH5N5hQ';

Deno.serve(async () => {
  const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY');
  if (!vapidPrivateKey) {
    return new Response(
      JSON.stringify({ error: 'VAPID_PRIVATE_KEY não configurada — avisos não podem ser enviados ainda.' }),
      { status: 200 }, // 200 de propósito: não queremos que o cron fique re-tentando em erro
    );
  }

  webpush.setVapidDetails('mailto:suporte@controlefinanceiro.app', VAPID_PUBLIC_KEY, vapidPrivateKey);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: dueReminders } = await supabase
    .from('payment_reminder')
    .select('id, user_id, due_date, loan_installment_id')
    .eq('status', 'PENDING')
    .lte('scheduled_for', new Date().toISOString())
    .limit(200);

  let sent = 0;
  let failed = 0;

  for (const reminder of dueReminders ?? []) {
    const { data: subs } = await supabase
      .from('push_subscription')
      .select('endpoint, p256dh, auth')
      .eq('user_id', reminder.user_id);

    const payload = JSON.stringify({
      title: 'Parcela vence em breve',
      body: `Vencimento em ${new Date(reminder.due_date).toLocaleDateString('pt-BR')}`,
      url: '/financiamentos',
    });

    for (const sub of subs ?? []) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        );
        sent++;
      } catch {
        failed++; // inscrição expirada/inválida — ignora, não derruba os outros envios
      }
    }

    await supabase.from('payment_reminder').update({ status: 'SENT', sent_at: new Date().toISOString() }).eq('id', reminder.id);
  }

  return new Response(JSON.stringify({ processed: dueReminders?.length ?? 0, sent, failed }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
