import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { toast } from '@/hooks/use-toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

// Served by the Veyra API, which fetches the GitHub release metadata
// server-side. Fetching github.com directly fails in the Android WebView
// because release downloads redirect to asset hosts without CORS headers.
const RELEASE_URL = '/api/app-version';
// The Android shell loads the deployed web app, so VITE_APP_VERSION reflects
// the web build — not the installed APK. The native package version (stamped
// by scripts/configure-android-release.mjs at build time) is the source of
// truth; the env var is only a fallback for older shells.
const BUILD_VERSION = import.meta.env.VITE_APP_VERSION || '';

function normalizeVersion(value: string) {
  return value.trim().replace(/^v/i, '');
}

async function installedVersion() {
  try {
    const info = await App.getInfo();
    const native = normalizeVersion(info?.version || '');
    if (native) return native;
  } catch {
    // Older shells may not expose App.getInfo; fall through to the build env.
  }
  return normalizeVersion(BUILD_VERSION) || '0.0.0';
}

function compareVersions(left: string, right: string) {
  // Extract the leading digits of each part so pre-release/build suffixes
  // ('1.2.3-beta', '1.2.3+build') still compare numerically.
  const parse = (value: string) => normalizeVersion(value)
    .split('.')
    .map((part) => Number(part.match(/^\d+/)?.[0] ?? NaN));
  const a = parse(left); const b = parse(right);
  const length = Math.max(a.length, b.length, 3);
  if (a.length > 4 || b.length > 4 || [...a, ...b].some((part) => !Number.isInteger(part) || part < 0)) return 0;
  for (let i = 0; i < length; i++) {
    const leftPart = a[i] ?? 0; const rightPart = b[i] ?? 0;
    if (leftPart !== rightPart) return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}

type ReleaseInfo = {
  version?: string;
  tag?: string;
  notes?: string;
  name?: string;
  android?: { file?: string; url?: string };
};

export function AndroidUpdateCheck() {
  const [release, setRelease] = useState<ReleaseInfo | null>(null);
  const [open, setOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const [currentVersion, setCurrentVersion] = useState(BUILD_VERSION || '…');

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;
    let cancelled = false;
    void (async () => {
      try {
        const installed = await installedVersion();
        if (cancelled) return;
        setCurrentVersion(installed);
        const response = await fetch(RELEASE_URL, { cache: 'no-store' });
        if (response.status === 404) return; // No published release yet.
        if (!response.ok) throw new Error(`Release check failed (HTTP ${response.status}).`);
        const info = await response.json() as ReleaseInfo;
        if (cancelled || !info.version || !info.android?.url || compareVersions(info.version, installed) <= 0) return;
        setRelease(info);
        setOpen(true);
      } catch (error) {
        console.warn('Could not check for Android updates:', error);
        toast({
          title: 'Update check failed',
          description: 'Veyra could not reach the release server. You are still running the current version.',
          variant: 'destructive',
        });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const download = async () => {
    if (!release?.android?.url || opening) return;
    setOpening(true);
    try {
      await Browser.open({ url: release.android.url });
    } catch (error) {
      console.warn('Could not open the Android update download:', error);
      toast({
        title: 'Download failed',
        description: 'Could not open the update download. Please check your connection and try again.',
        variant: 'destructive',
      });
    } finally {
      setOpening(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Veyra {release?.version} is available</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>You are running Veyra {currentVersion}. Download the new APK to update.</p>
              {release?.notes || release?.name ? (
                <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                  {release.notes || release.name}
                </p>
              ) : null}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={opening}>Later</AlertDialogCancel>
          <AlertDialogAction onClick={(event) => { event.preventDefault(); void download(); }} disabled={opening}>
            {opening ? 'Opening…' : 'Download update'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
