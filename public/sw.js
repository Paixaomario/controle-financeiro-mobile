/**
 * Service Worker do PWA.
 *
 * Responsável por: (1) permitir que o navegador entregue os avisos de
 * vencimento como notificação real, mesmo com o app fechado, via Web
 * Push; (2) dar suporte básico offline ao shell do app.
 *
 * Isso SUBSTITUI o WorkManager/AlarmManager que estava planejado para o
 * app Android nativo (Fase 4 original) — é a versão possível dentro de
 * um PWA. Funciona bem no Chrome Android. No iOS, Web Push em PWA só
 * tem suporte a partir do iOS 16.4+ e exige que o usuário tenha
 * "adicionado à tela de início" — é uma limitação da própria Apple, não
 * do código.
 */

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};

  const title = data.title || 'Parcela vence hoje';
  const options = {
    body: data.body || 'Você tem um vencimento pendente.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: data.url || '/reminders' },
    // cor de aviso (âmbar) é aplicada no lado do app, a notificação do
    // sistema operacional usa o ícone acima para reforçar a identidade
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';
  event.waitUntil(clients.openWindow(targetUrl));
});

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});
