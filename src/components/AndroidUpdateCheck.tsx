import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
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
const INSTALLED_VERSION = import.meta.env.VITE_APP_VERSION || '0.0.0';

function compareVersions(left: string, right: string) {
  const parse = (value: string) => value.replace(/^v/, '').split('.').map((part) => Number(part));
  const a = parse(left); const b = parse(right);
  if (a.length !== 3 || b.length !== 3 || [...a, ...b].some((part) => !Number.isInteger(part) || part < 0)) return 0;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
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

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(RELEASE_URL, { cache: 'no-store' });
        if (response.status === 404) return; // No published release yet.
        if (!response.ok) throw new Error(`Release check failed (HTTP ${response.status}).`);
        const info = await response.json() as ReleaseInfo;
        if (cancelled || !info.version || !info.android?.url || compareVersions(info.version, INSTALLED_VERSION) <= 0) return;
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
              <p>You are running Veyra {INSTALLED_VERSION}. Download the new APK to update.</p>
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
