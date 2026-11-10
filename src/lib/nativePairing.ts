import { Capacitor } from '@capacitor/core';
import { authRequest, notifyAuthChanged } from '@/lib/authApi';
import { setNativeSessionToken } from '@/lib/nativeSession';

const pendingPairCodes = new Set<string>();
const completedPairCodes = new Set<string>();
const activeCallbacks = new Map<string, Promise<void>>();

export function registerNativePair(code: string) {
  pendingPairCodes.add(code);
}

export function clearNativePair(code: string) {
  pendingPairCodes.delete(code);
}

export function markNativePairComplete(code: string) {
  pendingPairCodes.delete(code);
  completedPairCodes.add(code);
  window.setTimeout(() => completedPairCodes.delete(code), 5 * 60 * 1000);
}

function emit(name: string, detail: Record<string, string>) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

async function closeAndroidBrowser() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { Browser } = await import('@capacitor/browser');
    await Browser.close();
  } catch {
    // The custom tab may already be closed by Android when it returns to Veyra.
  }
}

async function handlePairCallback(rawUrl: string) {
  let callback: URL;
  try {
    callback = new URL(rawUrl);
  } catch {
    return;
  }
  if (callback.protocol !== 'veyra:' || callback.hostname !== 'pair') return;

  const code = callback.searchParams.get('code') || '';
  const clientId = callback.searchParams.get('clientId') || '';
  const expectedClientId = window.veyraDesktop ? 'desktop' : Capacitor.isNativePlatform() ? 'android' : '';
  if (!expectedClientId || clientId !== expectedClientId || code.length < 32 || code.length > 128) return;

  await closeAndroidBrowser();
  if (pendingPairCodes.has(code) || completedPairCodes.has(code)) {
    emit('veyra-native-pair-returned', { code });
    return;
  }

  const existing = activeCallbacks.get(code);
  if (existing) return existing;
  const exchange = (async () => {
    try {
      const result = await authRequest<{ token: string; clientId: string }>('native/exchange', { code, clientId });
      if (result.clientId !== expectedClientId || !result.token) throw new Error('The pairing response was invalid.');
      await setNativeSessionToken(result.token);
      markNativePairComplete(code);
      notifyAuthChanged();
      emit('veyra-native-pair-complete', { code });
    } catch (error) {
      emit('veyra-native-pair-error', {
        code,
        error: error instanceof Error ? error.message : 'Could not finish signing in to Veyra.',
      });
    } finally {
      activeCallbacks.delete(code);
    }
  })();
  activeCallbacks.set(code, exchange);
  return exchange;
}

export async function initializeNativePairCallbacks() {
  if (window.veyraDesktop) {
    window.veyraDesktop.onPairCallback((url) => void handlePairCallback(url));
  }

  if (!Capacitor.isNativePlatform()) return;
  try {
    const { App } = await import('@capacitor/app');
    await App.addListener('appUrlOpen', ({ url }) => void handlePairCallback(url));
    const launch = await App.getLaunchUrl();
    if (launch?.url) await handlePairCallback(launch.url);
  } catch (error) {
    console.warn('Could not initialize native Veyra sign-in callback:', error);
  }
}
