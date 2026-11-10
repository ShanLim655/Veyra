import { Capacitor } from '@capacitor/core';
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';

const SESSION_KEY = 'veyra_session_token';
let cachedToken: string | null | undefined;
let loadingToken: Promise<string | null> | null = null;

declare global {
  interface Window {
    veyraDesktop?: {
      openExternal(url: string): Promise<void>;
      getSessionToken(): Promise<string | null>;
      setSessionToken(token: string): Promise<void>;
      clearSessionToken(): Promise<void>;
      onPairCallback(callback: (url: string) => void): void;
    };
  }
}

export function isNativeVeyraApp() {
  return Boolean(window.veyraDesktop) || Capacitor.isNativePlatform();
}

export async function getNativeSessionToken(): Promise<string | null> {
  if (cachedToken !== undefined) return cachedToken;
  if (loadingToken) return loadingToken;
  loadingToken = (async () => {
    if (window.veyraDesktop) return window.veyraDesktop.getSessionToken();
    if (Capacitor.isNativePlatform()) {
      try {
        return (await SecureStoragePlugin.get({ key: SESSION_KEY })).value || null;
      } catch {
        return null;
      }
    }
    return null;
  })();
  try {
    cachedToken = await loadingToken;
    return cachedToken;
  } finally {
    loadingToken = null;
  }
}

export async function setNativeSessionToken(token: string) {
  if (window.veyraDesktop) {
    await window.veyraDesktop.setSessionToken(token);
    cachedToken = token;
    return;
  }
  if (Capacitor.isNativePlatform()) {
    await SecureStoragePlugin.set({ key: SESSION_KEY, value: token });
    cachedToken = token;
  }
}

export async function clearNativeSessionToken() {
  if (window.veyraDesktop) {
    await window.veyraDesktop.clearSessionToken();
    cachedToken = null;
    return;
  }
  if (Capacitor.isNativePlatform()) {
    try {
      await SecureStoragePlugin.remove({ key: SESSION_KEY });
    } catch {
      // Already cleared or never saved.
    }
    cachedToken = null;
  }
}

export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const token = await getNativeSessionToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const request = { ...init, headers, credentials: init.credentials || 'same-origin' } as RequestInit;
  const response = await fetch(input, request);
  if (token && response.status === 401) {
    await clearNativeSessionToken();
    headers.delete('Authorization');
    return fetch(input, request);
  }
  return response;
}

export async function openSystemBrowser(url: string) {
  if (window.veyraDesktop) return window.veyraDesktop.openExternal(url);
  if (Capacitor.isNativePlatform()) {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url, presentationStyle: 'popover' });
    return;
  }
  window.location.assign(url);
}
