"use client";

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { ATTACHMENTS_BUCKET, formatBytes, type Attachment } from '@/lib/attachments';

// Renders one attachment inside a chat message. Content is in a private
// bucket, so we resolve a short-lived signed URL per render.
export default function AttachmentView({ attachment }: { attachment: Attachment }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!supabase) return;
    supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .createSignedUrl(attachment.path, 3600)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data?.signedUrl) setFailed(true);
        else setUrl(data.signedUrl);
      });
    return () => { cancelled = true; };
  }, [attachment.path]);

  const chip = (
    <samp style={{
      display: 'inline-flex', alignItems: 'center', gap: '6px',
      padding: '6px 10px', margin: '4px 4px 4px 0',
      border: '1px solid var(--grid-thick)', background: 'var(--bg-raised)',
      fontSize: 'var(--micro)', color: 'var(--fg-dim)',
    }}>
      [ {attachment.kind.toUpperCase()} ] {attachment.name} · {formatBytes(attachment.size)}
    </samp>
  );

  if (failed) return chip;
  if (!url) return chip;

  if (attachment.kind === 'image') {
    return (
      <a href={url} target="_blank" rel="noreferrer" style={{ display: 'block', margin: '6px 0' }}>
        {/* Signed URLs expire, so next/image optimization caching is wrong here */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={attachment.name}
          style={{ maxWidth: 'min(420px, 100%)', maxHeight: '360px', border: '1px solid var(--grid-thick)', display: 'block' }}
        />
      </a>
    );
  }

  if (attachment.kind === 'audio') {
    return (
      <div style={{ margin: '6px 0' }}>
        {chip}
        <audio controls src={url} style={{ display: 'block', width: 'min(420px, 100%)', marginTop: '4px' }} />
      </div>
    );
  }

  if (attachment.kind === 'video') {
    return (
      <div style={{ margin: '6px 0' }}>
        {chip}
        <video controls src={url} style={{ display: 'block', maxWidth: 'min(480px, 100%)', border: '1px solid var(--grid-thick)', marginTop: '4px' }} />
      </div>
    );
  }

  return (
    <a href={url} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
      {chip}
    </a>
  );
}
