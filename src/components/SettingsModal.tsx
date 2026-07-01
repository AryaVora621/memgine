"use client";

import { useState, useEffect } from 'react';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [keys, setKeys] = useState({
    openrouter: '',
    anthropic: '',
    openai: '',
    google: '',
  });
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      fetch('/api/settings')
        .then(r => r.json())
        .then(data => {
          if (data.apiKeys) setKeys(data.apiKeys);
        })
        .catch(() => {});
    }
  }, [open]);

  const handleSave = async () => {
    setLoading(true);
    setStatus('');
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKeys: keys }),
      });
      if (res.ok) {
        setStatus('SAVED');
        setTimeout(() => onClose(), 800);
      } else {
        const data = await res.json();
        setStatus(`ERROR: ${data.error}`);
      }
    } catch (e: any) {
      setStatus(`ERROR: ${e.message}`);
    }
    setLoading(false);
  };

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <samp>[ SETTINGS / API_KEYS ]</samp>
          <button className="modal-close" onClick={onClose}>X</button>
        </div>
        <hr className="modal-hr" />

        <div className="modal-body">
          {(['anthropic', 'openai', 'openrouter', 'google'] as const).map(provider => (
            <div className="field-row" key={provider}>
              <label className="field-label">{provider.toUpperCase()}</label>
              <input
                className="field-input"
                type="password"
                value={keys[provider]}
                onChange={e => setKeys(prev => ({ ...prev, [provider]: e.target.value }))}
                placeholder={`${provider.toUpperCase()} API KEY...`}
                spellCheck={false}
              />
            </div>
          ))}
        </div>

        <hr className="modal-hr" />
        <div className="modal-footer">
          {status && (
            <samp className={`modal-status ${status === 'SAVED' ? 'ok' : 'err'}`}>
              {status}
            </samp>
          )}
          <button className="modal-save" onClick={handleSave} disabled={loading}>
            {loading ? 'SAVING...' : '[ SAVE ]'}
          </button>
        </div>
      </div>
    </div>
  );
}
