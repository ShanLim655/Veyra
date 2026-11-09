import type { Database } from './types';
import { authClient } from './client-core';
import { fromMariaDB, rpcMariaDB } from './data-api';

async function sendNotificationTest() {
  try {
    const response = await fetch('/api/notifications/test', {
      method: 'POST', credentials: 'same-origin',
    });
    const data = await response.json() as { ok?: boolean; error?: string | null };
    return response.ok ? { data, error: null } : { data: null, error: { message: data.error || 'Notification failed.' } };
  } catch (error) {
    return { data: null, error: { message: error instanceof Error ? error.message : 'Notification failed.' } };
  }
}

const functionsClient = new Proxy(authClient.functions, {
  get(target, property, receiver) {
    if (property === 'invoke') return (name: string) =>
      name === 'send-ntfy' ? sendNotificationTest() : target.invoke(name);
    const value = Reflect.get(target, property, target);
    return typeof value === 'function' ? value.bind(target) : value;
  },
});

function mariaRealtimeChannel(name: string) {
  type MutableChannel = {
    on: (type: string, filter: unknown, callback: (payload: unknown) => void) => MutableChannel;
    subscribe: (callback?: (status: string, error?: unknown) => void) => MutableChannel;
    unsubscribe: () => Promise<string>;
  };
  const channel = authClient.channel(name) as unknown as MutableChannel;
  const originalOn = channel.on.bind(channel) as MutableChannel['on'];
  const originalSubscribe = channel.subscribe.bind(channel) as MutableChannel['subscribe'];
  const originalUnsubscribe = channel.unsubscribe.bind(channel);
  const databaseListeners: Array<(payload: unknown) => void> = [];
  let pollingTimer: ReturnType<typeof setInterval> | undefined;

  channel.on = (type: string, filter: unknown, callback: (payload: unknown) => void) => {
    if (type === 'postgres_changes') databaseListeners.push(callback);
    else originalOn(type, filter, callback);
    return channel;
  };
  channel.subscribe = (callback?: (status: string) => void) => {
    if (databaseListeners.length && !pollingTimer) {
      pollingTimer = setInterval(() => {
        for (const listener of databaseListeners) listener({ eventType: '*', new: {}, old: {} });
      }, 5000);
    }
    const result = originalSubscribe((status: string, error?: unknown) => {
      callback?.(status);
      if (error) console.warn('Supabase Realtime channel error', error);
    });
    return result as MutableChannel;
  };
  channel.unsubscribe = () => {
    if (pollingTimer) clearInterval(pollingTimer);
    pollingTimer = undefined;
    return originalUnsubscribe() as Promise<string>;
  };
  return channel;
}

// Supabase is used for Storage and Realtime presence. Authentication, table
// data, and RPC calls are handled by the Veyra API and MariaDB.
export const supabase = new Proxy(authClient, {
  get(target, property, receiver) {
    if (property === 'from') return (table: string) => fromMariaDB(table);
    if (property === 'rpc') return (name: string, args?: Record<string, unknown>) =>
      name === 'get_user_sessions' || name === 'revoke_user_session'
        ? authClient.rpc(name as never, args as never)
        : rpcMariaDB(name, args);
    if (property === 'channel') return (name: string) => mariaRealtimeChannel(name);
    if (property === 'functions') return functionsClient;
    const value = Reflect.get(target, property, target);
    return typeof value === 'function' ? value.bind(target) : value;
  },
}) as typeof authClient & { __databaseType?: Database };
