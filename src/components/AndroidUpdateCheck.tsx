import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';

const RELEASE_URL = 'https://github.com/ShanLim655/Veyra/releases/latest/download/latest.json';
const INSTALLED_VERSION = import.meta.env.VITE_APP_VERSION || '0.0.0';

function compareVersions(left: string, right: string) {
  const parse = (value: string) => value.replace(/^v/, '').split('.').map((part) => Number(part));
  const a = parse(left); const b = parse(right);
  if (a.length !== 3 || b.length !== 3 || [...a, ...b].some((part) => !Number.isInteger(part) || part < 0)) return 0;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}

export function AndroidUpdateCheck() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(RELEASE_URL, { cache: 'no-store' });
        if (!response.ok) return;
        const release = await response.json() as { version?: string; android?: { url?: string } };
        if (cancelled || !release.version || !release.android?.url || compareVersions(release.version, INSTALLED_VERSION) <= 0) return;
        if (!window.confirm(`Veyra ${release.version} is available. Update now?\n\nChoose Cancel to be reminded the next time you open Veyra.`)) return;
        await Browser.open({ url: release.android.url });
      } catch (error) {
        console.warn('Could not check for Android updates:', error);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return null;
}
