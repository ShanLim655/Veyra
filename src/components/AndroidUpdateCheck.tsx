import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';

const RELEASE_URL = 'https://github.com/ShanLim655/Veyra/releases/latest/download/latest.json';
const INSTALLED_VERSION = import.meta.env.VITE_APP_VERSION || '0.0.0';

function compareVersions(left: string, right: string) {
  const parse = (value: string) => {
    const normalized = value.replace(/^v/, '');
    return /^\d+\.\d+\.\d+$/.test(normalized) ? normalized.split('.').map(Number) : null;
  };
  const a = parse(left); const b = parse(right);
  if (!a || !b) return 0;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}

export function AndroidUpdateCheck() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(RELEASE_URL, { cache: 'no-store', signal: AbortSignal.timeout(7000) });
        if (!response.ok) return;
        const release = await response.json() as { version?: string; android?: { url?: string } };
        if (cancelled || !/^\d+\.\d+\.\d+$/.test(release.version || '') || !release.android?.url || compareVersions(release.version, INSTALLED_VERSION) <= 0) return;
        const downloadUrl = new URL(release.android.url);
        if (downloadUrl.protocol !== 'https:' || downloadUrl.hostname !== 'github.com' || !downloadUrl.pathname.startsWith('/ShanLim655/Veyra/releases/download/')) return;
        if (!window.confirm(`Veyra ${release.version} is available. Update now?\n\nChoose Cancel to be reminded the next time you open Veyra.`)) return;
        await Browser.open({ url: downloadUrl.toString() });
      } catch (error) {
        console.warn('Could not check for Android updates:', error);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return null;
}
