"use client";

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

interface ConnectorRow {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  auth_token: string | null;
  oauth: { access_token?: string } | null;
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

  const [connectors, setConnectors] = useState<ConnectorRow[]>([]);
  const [newConn, setNewConn] = useState({ name: '', url: '', token: '' });
  const [connStatus, setConnStatus] = useState('');

  const [autoAccept, setAutoAccept] = useState(false);
  const [mcpKeySet, setMcpKeySet] = useState(false);
  const [mcpNewKey, setMcpNewKey] = useState('');
  const [mcpStatus, setMcpStatus] = useState('');

  const regenerateMcpKey = async () => {
    setMcpStatus('GENERATING...');
    try {
      const res = await fetch('/api/mcp/key', { method: 'POST' });
      const data = await res.json();
      if (!data.success) { setMcpStatus(`ERROR: ${data.error}`); return; }
      setMcpNewKey(data.key);
      setMcpKeySet(true);
      setMcpStatus('');
    } catch {
      setMcpStatus('ERROR: request failed');
    }
  };

  const toggleAutoAccept = async () => {
    const next = !autoAccept;
    setAutoAccept(next);
    if (!supabase) return;
    await supabase.from('operator_settings').update({ auto_accept: next, updated_at: new Date().toISOString() }).eq('id', true);
  };

  const loadConnectors = () => {
    if (!supabase) return;
    supabase.from('connectors').select('id, name, url, enabled, auth_token, oauth').order('created_at')
      .then(({ data }) => { if (data) setConnectors(data); });
  };

  useEffect(() => {
    if (open) {
      fetch('/api/settings')
        .then(r => r.json())
        .then(data => {
          if (data.apiKeys) setKeys(data.apiKeys);
        })
        .catch(() => {});
      loadConnectors();
      queueMicrotask(() => setConnStatus(''));
      if (supabase) {
        supabase.from('operator_settings').select('auto_accept, mcp_key_hash').eq('id', true).single()
          .then(({ data }) => {
            if (data) setAutoAccept(!!data.auto_accept);
            setMcpKeySet(!!data?.mcp_key_hash);
          });
      }
      setMcpNewKey('');
      setMcpStatus('');
    }
  }, [open]);

  const addConnector = async () => {
    if (!supabase || !newConn.name.trim() || !newConn.url.trim()) return;
    const name = newConn.name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    const { error } = await supabase.from('connectors').insert({
      name,
      url: newConn.url.trim(),
      auth_token: newConn.token.trim() || null,
    });
    setConnStatus(error ? `ERROR: ${error.message}` : `ADDED ${name}`);
    if (!error) {
      setNewConn({ name: '', url: '', token: '' });
      loadConnectors();
    }
  };

  const toggleConnector = async (conn: ConnectorRow) => {
    if (!supabase) return;
    await supabase.from('connectors').update({ enabled: !conn.enabled }).eq('id', conn.id);
    loadConnectors();
  };

  const deleteConnector = async (conn: ConnectorRow) => {
    if (!supabase) return;
    await supabase.from('connectors').delete().eq('id', conn.id);
    loadConnectors();
  };

  // OAuth connect: the server discovers the auth server, registers a client,
  // and returns the authorization URL; the browser completes the grant there.
  const connectOAuth = async (conn: ConnectorRow) => {
    if (!supabase) return;
    setConnStatus(`STARTING OAUTH FOR ${conn.name}…`);
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    try {
      const res = await fetch('/api/oauth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ action: 'start', connectorId: conn.id, origin: window.location.origin }),
      });
      const json = await res.json();
      if (json.success && json.authUrl) {
        window.location.assign(json.authUrl);
      } else {
        setConnStatus(`ERROR: ${json.error || 'could not start OAuth'}`);
      }
    } catch (e) {
      setConnStatus(`ERROR: ${e instanceof Error ? e.message : 'oauth start failed'}`);
    }
  };

  const testConnectors = async () => {
    if (!supabase) return;
    setConnStatus('TESTING…');
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    try {
      const res = await fetch('/api/tools', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'request failed');
      const parts = (json.connectors as { name: string; status: string; tools: unknown[] }[])
        .map(c => `${c.name}: ${c.status === 'online' ? `${c.tools.length} TOOLS` : c.status.toUpperCase()}`);
      setConnStatus(parts.join(' · ') || 'NO CONNECTORS');
    } catch (e) {
      setConnStatus(`ERROR: ${e instanceof Error ? e.message : 'test failed'}`);
    }
  };

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
    } catch (e) {
      setStatus(`ERROR: ${e instanceof Error ? e.message : 'REQUEST FAILED'}`);
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
                autoComplete="new-password"
                value={keys[provider]}
                onChange={e => setKeys(prev => ({ ...prev, [provider]: e.target.value }))}
                placeholder={`${provider.toUpperCase()} API KEY...`}
                spellCheck={false}
              />
            </div>
          ))}

          <div className="field-row" style={{ marginTop: '12px' }}>
            <label className="field-label">THEME COLOR</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="color"
                defaultValue={typeof document !== 'undefined' ? getComputedStyle(document.documentElement).getPropertyValue('--red').trim() || '#E61919' : '#E61919'}
                onChange={(e) => {
                  document.documentElement.style.setProperty('--red', e.target.value);
                  localStorage.setItem('memgine-theme-color', e.target.value);
                }}
                style={{ background: 'transparent', border: '1px solid var(--grid-thick)', cursor: 'pointer', height: '28px', padding: 0 }}
              />
              <samp style={{ fontSize: 'var(--micro)', color: 'var(--fg-dim)' }}>SELECT ACCENT</samp>
            </div>
          </div>

          <hr className="modal-hr" style={{ margin: '16px 0' }} />
          <samp style={{ display: 'block', marginBottom: '8px' }}>[ APPROVAL MODE ]</samp>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
            <button
              className="action-btn"
              onClick={toggleAutoAccept}
              title="When on, approval cards (memory, tools, sandbox, edits, agents) run themselves. ASK_USER always waits for you."
            >
              {autoAccept ? 'AUTO-ACCEPT: ON' : 'AUTO-ACCEPT: OFF'}
            </button>
            <samp style={{ fontSize: 'var(--micro)', color: 'var(--fg-dim)' }}>
              GLOBAL, ACROSS ALL CHATS/PROJECTS. EVERYTHING EXCEPT ASK_USER.
            </samp>
          </div>

          <hr className="modal-hr" style={{ margin: '16px 0' }} />
          <samp style={{ display: 'block', marginBottom: '8px' }}>[ MCP SERVER — LET OTHER AGENTS CONNECT IN ]</samp>
          <samp style={{ display: 'block', marginBottom: '8px', fontSize: 'var(--micro)', color: 'var(--fg-dim)' }}>
            EXPOSES MEMGINE&apos;S MEMORY PALACE TO EXTERNAL MCP CLIENTS (CLAUDE DESKTOP, GEMINI, ETC.)
            SO THEY SHARE THE SAME FACTS THIS CHAT UI READS AND WRITES.
          </samp>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
            <button className="action-btn" onClick={regenerateMcpKey}>
              {mcpKeySet ? 'REGENERATE KEY' : 'GENERATE KEY'}
            </button>
            {mcpStatus && <samp style={{ fontSize: 'var(--micro)', color: 'var(--fg-dim)' }}>{mcpStatus}</samp>}
          </div>
          {mcpNewKey && (
            <div style={{ border: '1px solid var(--grid-thick)', padding: '10px', marginBottom: '8px', background: 'rgba(255,255,255,0.02)' }}>
              <samp style={{ display: 'block', fontSize: 'var(--micro)', color: 'var(--fg-dim)', marginBottom: '6px' }}>
                SHOWN ONCE — COPY IT NOW. PASTE INTO YOUR MCP CLIENT&apos;S CONFIG AS A BEARER TOKEN
                FOR <code>{typeof window !== 'undefined' ? window.location.origin : ''}/api/mcp</code>. REGENERATING REVOKES THE OLD KEY.
              </samp>
              <samp style={{ display: 'block', fontSize: 'var(--micro)', wordBreak: 'break-all', userSelect: 'all' }}>{mcpNewKey}</samp>
            </div>
          )}

          <hr className="modal-hr" style={{ margin: '16px 0' }} />
          <samp style={{ display: 'block', marginBottom: '8px' }}>[ CONNECTORS / MCP ]</samp>
          <samp style={{ display: 'block', marginBottom: '8px', fontSize: 'var(--micro)', color: 'var(--fg-dim)' }}>
            REMOTE MCP SERVERS. THEIR TOOLS BECOME AVAILABLE TO THE AGENT (APPROVAL-GATED).
          </samp>

          {connectors.map(conn => (
            <div key={conn.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <samp style={{ fontSize: 'var(--micro)', flex: 1, color: conn.enabled ? 'var(--fg)' : 'var(--fg-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {conn.name} · {conn.url}
                <span style={{ color: '#19B36B', marginLeft: '6px' }}>
                  {conn.auth_token ? '[TOKEN]' : conn.oauth?.access_token ? '[OAUTH ✓]' : ''}
                </span>
              </samp>
              {!conn.auth_token && (
                <button className="action-btn" onClick={() => connectOAuth(conn)}>
                  {conn.oauth?.access_token ? 'RECONNECT' : 'CONNECT'}
                </button>
              )}
              <button className="action-btn" onClick={() => toggleConnector(conn)}>
                {conn.enabled ? 'ON' : 'OFF'}
              </button>
              <button className="action-btn" style={{ color: 'var(--red)' }} onClick={() => deleteConnector(conn)}>
                [X]
              </button>
            </div>
          ))}

          <div className="field-row">
            <label className="field-label">NAME</label>
            <input className="field-input" value={newConn.name} spellCheck={false}
              onChange={e => setNewConn(prev => ({ ...prev, name: e.target.value }))}
              placeholder="github" />
          </div>
          <div className="field-row">
            <label className="field-label">URL</label>
            <input className="field-input" value={newConn.url} spellCheck={false}
              onChange={e => setNewConn(prev => ({ ...prev, url: e.target.value }))}
              placeholder="https://api.example.com/mcp" />
          </div>
          <div className="field-row">
            <label className="field-label">TOKEN</label>
            <input className="field-input" type="password" autoComplete="new-password" value={newConn.token} spellCheck={false}
              onChange={e => setNewConn(prev => ({ ...prev, token: e.target.value }))}
              placeholder="BEARER TOKEN (OPTIONAL)" />
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
            <button className="action-btn" onClick={addConnector} disabled={!newConn.name.trim() || !newConn.url.trim()}>
              [ ADD CONNECTOR ]
            </button>
            <button className="action-btn" onClick={testConnectors} disabled={connectors.length === 0}>
              [ TEST ]
            </button>
          </div>
          {connStatus && (
            <samp style={{ display: 'block', marginTop: '6px', fontSize: 'var(--micro)', color: connStatus.startsWith('ERROR') ? 'var(--red)' : 'var(--fg-dim)' }}>
              {connStatus}
            </samp>
          )}
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
