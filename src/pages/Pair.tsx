import { useState } from 'react';
import { authRequest } from '@/lib/authApi';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/hooks/useAuth';
import { Link } from 'react-router-dom';

export default function Pair() {
  const { user, loading } = useAuth();
  const code = new URLSearchParams(window.location.search).get('code') || '';
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const approve = async () => {
    setError('');
    try {
      await authRequest('native/pair/approve', { code });
      setDone(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not approve this device.');
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{done ? 'Device paired' : 'Pair a Veyra app'}</CardTitle>
          <CardDescription>
            {done ? 'Return to Veyra. This page can now be closed.' : 'Approve this one-time request to sign in to your Veyra app.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {user && <p>Signed in as <strong>{user.email}</strong></p>}
          {!loading && !user && (
            <div className="space-y-3">
              <p>Sign in to the Veyra account you want to use on this device.</p>
              <Button asChild className="w-full">
                <Link to={`/auth?returnTo=${encodeURIComponent(`/pair?code=${code}`)}`}>Sign in to continue</Link>
              </Button>
            </div>
          )}
          <p className="break-all text-xs text-muted-foreground">Code: {code || 'Missing code'}</p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {!done && <Button onClick={() => void approve()} disabled={!user || !code}>Approve this device</Button>}
        </CardContent>
      </Card>
    </main>
  );
}
