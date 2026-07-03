"use client";

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

// OAuth redirect target. The provider redirect can't carry our Supabase JWT,
// so this page picks up code+state from the URL and forwards them to
// /api/oauth with the operator's session for the token exchange.
function CallbackInner() {
  const params = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState('[ COMPLETING CONNECTOR AUTHORIZATION... ]');

  useEffect(() => {
    const code = params.get('code');
    const state = params.get('state');
    const providerError = params.get('error');

    const run = async () => {
      if (providerError) {
        setStatus(`[ AUTHORIZATION DENIED: ${providerError.toUpperCase()} ]`);
        return;
      }
      if (!code || !state || !supabase) {
        setStatus('[ MISSING CODE/STATE — RESTART THE CONNECT FLOW FROM SETTINGS ]');
        return;
      }
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        setStatus('[ NOT LOGGED IN — LOG IN AND RECONNECT FROM SETTINGS ]');
        return;
      }
      try {
        const res = await fetch('/api/oauth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ action: 'exchange', code, state }),
        });
        const json = await res.json();
        if (json.success) {
          setStatus(`[ CONNECTED: ${String(json.connector).toUpperCase()} — RETURNING... ]`);
          setTimeout(() => router.replace('/'), 1200);
        } else {
          setStatus(`[ ERROR: ${json.error} ]`);
        }
      } catch (e) {
        setStatus(`[ ERROR: ${e instanceof Error ? e.message : 'exchange failed'} ]`);
      }
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="app-shell" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <samp style={{ color: 'var(--fg-dim)' }}>{status}</samp>
    </div>
  );
}

export default function OAuthCallbackPage() {
  return (
    <Suspense fallback={<div className="app-shell" />}>
      <CallbackInner />
    </Suspense>
  );
}
