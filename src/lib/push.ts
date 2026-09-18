import { supabase, ensureAppUser } from './supabase';

const DEFAULT_VAPID_PUBLIC_KEY =
  'BJf0Z3M9u181D433RThotwg9xA5q5HdgWwhWZuK3hHXHxCOQSYMHtGmkv8Qc9HVlZEITF4etSxHFqVKWvH5N5hQ';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

export type PushEnableResult = 'enabled' | 'denied' | 'unsupported';

/**
 * Pede permissão de notificação, inscreve o dispositivo no Web Push, e
 * grava a inscrição direto na tabela `push_subscription` do Supabase
 * (protegida por RLS — cada usuário só grava/lê a própria).
 */
export async function enablePushNotifications(): Promise<PushEnableResult> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return 'unsupported';
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';

  const registration = await navigator.serviceWorker.ready;
  const vapidPublicKey = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) || DEFAULT_VAPID_PUBLIC_KEY;

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
  });

  const json = subscription.toJSON();
  const uid = await ensureAppUser();

  await supabase.from('push_subscription').upsert(
    {
      user_id: uid,
      endpoint: json.endpoint!,
      p256dh: json.keys?.p256dh!,
      auth: json.keys?.auth!,
    },
    { onConflict: 'endpoint' },
  );

  return 'enabled';
}

export async function isPushEnabled(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  return subscription !== null;
}
