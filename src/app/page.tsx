"use client";

import { useState, useRef, useEffect, useCallback } from 'react';
import GraphView from '@/components/GraphView';
import SettingsModal from '@/components/SettingsModal';
import { supabase } from '@/lib/supabaseClient';

interface Message {
  role: 'user' | 'assistant' | 'system';
  text: string;
  timestamp: string;
}

interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: string;
}

const MODELS = [
  { id: 'claude-sonnet-4-20250514', label: 'CLAUDE SONNET 4' },
  { id: 'claude-4-opus', label: 'CLAUDE 4 OPUS' },
  { id: 'gpt-4.1', label: 'GPT-4.1' },
  { id: 'gpt-4o', label: 'GPT-4O' },
  { id: 'gemini-2.5-pro', label: 'GEMINI 2.5 PRO' },
  { id: 'openrouter/auto', label: 'OPENROUTER / AUTO' },
  { id: 'agy-local', label: 'AGY -P (LOCAL)' },
  { id: 'claude-local', label: 'CLAUDE -P (LOCAL)' },
];

function ts(): string {
  return new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function Home() {
  const [tab, setTab] = useState<'chat' | 'graph'>('chat');
  const [message, setMessage] = useState('');
  const [model, setModel] = useState(MODELS[0].id);
  const [loading, setLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [graphRefresh, setGraphRefresh] = useState(0);

  // Environment check
  const [isLocal, setIsLocal] = useState(false);

  // Authentication
  const [user, setUser] = useState<any>(null);
  const [syncing, setSyncing] = useState(false);

  // Projects
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectIdx, setActiveProjectIdx] = useState(-1);
  const [newProjectName, setNewProjectName] = useState('');
  const [showNewProject, setShowNewProject] = useState(false);

  // Messages keyed by project id
  const [messagesByProject, setMessagesByProject] = useState<Record<string, Message[]>>({});

  const scrollRef = useRef<HTMLDivElement>(null);

  const activeProject = activeProjectIdx >= 0 ? projects[activeProjectIdx] : null;
  const currentMessages = activeProject ? (messagesByProject[activeProject.id] || []) : [];

  // Check if local or Vercel
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setIsLocal(
        window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1' ||
        window.location.hostname.startsWith('192.168.')
      );
    }
  }, []);

  const filteredModels = MODELS.filter(m => {
    if (m.id.endsWith('-local')) {
      return isLocal;
    }
    return true;
  });

  // Reconcile and Sync function
  const handleSync = useCallback(async (currentUser: any) => {
    if (!currentUser) return;
    setSyncing(true);
    try {
      // 1. Fetch projects from local backend
      const localRes = await fetch('/api/projects');
      const localData = await localRes.json();
      const localProjects: Project[] = localData.projects || [];

      // 2. Fetch projects from Supabase
      const { data: dbProjects, error: dbProjErr } = await supabase
        .from('projects')
        .select('*');

      if (dbProjErr) throw dbProjErr;

      // Sync local projects to Supabase (Upload)
      for (const localProj of localProjects) {
        const exists = dbProjects?.some(p => p.id === localProj.id);
        if (!exists) {
          await supabase
            .from('projects')
            .insert({
              id: localProj.id,
              name: localProj.name,
              path: localProj.path,
              user_id: currentUser.id
            });
        }
      }

      // Sync Supabase projects to local (Download)
      const { data: updatedDbProjects } = await supabase
        .from('projects')
        .select('*');

      let localUpdatedList = [...localProjects];
      for (const dbProj of updatedDbProjects || []) {
        const exists = localProjects.some(p => p.id === dbProj.id);
        if (!exists) {
          const res = await fetch('/api/projects', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: dbProj.name, path: dbProj.path, id: dbProj.id }),
          });
          const data = await res.json();
          if (data.success && data.project) {
            localUpdatedList.push(data.project);
          }
        }
      }
      setProjects(localUpdatedList);

      // 3. For each project, sync memories
      for (const proj of localUpdatedList) {
        const memRes = await fetch(`/api/memory?projectId=${proj.id}`);
        const memData = await memRes.json();
        const localMemories = memData.nodes || [];

        const { data: dbMemories, error: dbMemErr } = await supabase
          .from('memories')
          .select('*')
          .eq('project_id', proj.id);

        if (dbMemErr) throw dbMemErr;

        // Sync local memories to Supabase (Upload)
        for (const localMem of localMemories) {
          const exists = dbMemories?.some(m => m.id === localMem.id);
          if (!exists) {
            await supabase
              .from('memories')
              .insert({
                id: localMem.id,
                project_id: proj.id,
                user_id: currentUser.id,
                content: localMem.fullContent,
                role: localMem.role,
                metadata: {},
                parent_id: localMem.parent_id || null,
                timestamp: localMem.timestamp
              });
          }
        }

        // Sync Supabase memories to local SQLite (Download)
        const missingLocally = dbMemories?.filter(dbMem => !localMemories.some((lm: any) => lm.id === dbMem.id)) || [];
        if (missingLocally.length > 0) {
          await fetch('/api/memory/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              projectId: proj.id,
              memories: missingLocally
            })
          });
        }
      }

      setGraphRefresh(prev => prev + 1);
    } catch (error) {
      console.error('Sync error:', error);
    } finally {
      setSyncing(false);
    }
  }, []);

  // Listen for Supabase Auth state changes
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        handleSync(session.user);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        handleSync(session.user);
      }
    });

    return () => subscription.unsubscribe();
  }, [handleSync]);

  // Load local projects on mount
  useEffect(() => {
    fetch('/api/projects')
      .then(r => r.json())
      .then(data => {
        if (data.projects && data.projects.length > 0) {
          setProjects(data.projects);
          setActiveProjectIdx(0);
        }
      })
      .catch(() => {});
  }, []);

  // Auto-scroll chat
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [currentMessages]);

  // Init system message when switching projects
  useEffect(() => {
    if (!activeProject) return;
    if (!messagesByProject[activeProject.id]) {
      setMessagesByProject(prev => ({
        ...prev,
        [activeProject.id]: [
          { role: 'system', text: `[ SYS_INIT ] CONTEXT ENGINE LOADED FOR PROJECT: ${activeProject.name}`, timestamp: ts() },
        ],
      }));
    }
    setGraphRefresh(prev => prev + 1);
  }, [activeProject?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const addMessage = useCallback((projectId: string, msg: Message) => {
    setMessagesByProject(prev => ({
      ...prev,
      [projectId]: [...(prev[projectId] || []), msg],
    }));
  }, []);

  const handleSend = async () => {
    if (!message.trim() || !activeProject || loading) return;

    const userMsg: Message = { role: 'user', text: message, timestamp: ts() };
    addMessage(activeProject.id, userMsg);
    setMessage('');
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: activeProject.id,
          message: message,
          model,
        }),
      });

      const data = await res.json();

      if (data.success) {
        addMessage(activeProject.id, {
          role: 'assistant',
          text: data.response,
          timestamp: ts(),
        });
        setGraphRefresh(prev => prev + 1);

        // Upload both newly added messages to Supabase if logged in
        if (user) {
          // Upload user message
          await supabase.from('memories').insert({
            id: data.userMessageId,
            project_id: activeProject.id,
            user_id: user.id,
            content: userMsg.text,
            role: 'user',
            metadata: {},
            parent_id: null,
            timestamp: new Date().toISOString()
          });

          // Upload assistant message
          await supabase.from('memories').insert({
            id: data.assistantMessageId,
            project_id: activeProject.id,
            user_id: user.id,
            content: data.response,
            role: 'assistant',
            metadata: { model },
            parent_id: data.userMessageId,
            timestamp: new Date().toISOString()
          });
        }

      } else {
        addMessage(activeProject.id, {
          role: 'system',
          text: `[ ERROR ] ${data.error}`,
          timestamp: ts(),
        });
      }
    } catch (e: any) {
      addMessage(activeProject.id, {
        role: 'system',
        text: `[ NETWORK_ERROR ] ${e.message}`,
        timestamp: ts(),
      });
    }

    setLoading(false);
  };

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return;
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newProjectName }),
      });
      const data = await res.json();
      if (data.success && data.project) {
        setProjects(prev => [...prev, data.project]);
        setActiveProjectIdx(projects.length);
        setNewProjectName('');
        setShowNewProject(false);

        // Create project in Supabase if logged in
        if (user) {
          await supabase.from('projects').insert({
            id: data.project.id,
            name: data.project.name,
            path: data.project.path,
            user_id: user.id
          });
        }
      }
    } catch {}
  };

  const handleLogin = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin
      }
    });
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  const tagFor = (role: string) => {
    if (role === 'user') return '< USER_INPUT >';
    if (role === 'system') return '< SYSTEM >';
    return '< AI_RESPONSE >';
  };

  return (
    <>
      <div className="app-shell">
        {/* ── SIDEBAR ── */}
        <nav className="sidebar">
          <div className="sidebar-brand crosshairs">
            <h1>NB</h1>
            <samp className="brand-sub">{"/// CONTEXT ENGINE"}</samp>
          </div>

          <hr />

          <div className="sidebar-dirs">
            <samp className="section-label">[ DIRECTORIES ]</samp>
            <ul className="dir-list">
              {projects.map((proj, i) => (
                <li key={proj.id}>
                  <button
                    className={`dir-btn ${i === activeProjectIdx ? 'active' : ''}`}
                    onClick={() => setActiveProjectIdx(i)}
                  >
                    <span className="dir-prefix">{i === activeProjectIdx ? '>>>' : '---'}</span>
                    <span>{proj.name}</span>
                    <span className="dir-index">[{String(i + 1).padStart(2, '0')}]</span>
                  </button>
                </li>
              ))}
            </ul>

            {/* New project input */}
            {showNewProject ? (
              <div className="new-project-row">
                <input
                  className="new-project-input"
                  value={newProjectName}
                  onChange={e => setNewProjectName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleCreateProject(); if (e.key === 'Escape') setShowNewProject(false); }}
                  placeholder="PROJECT NAME..."
                  autoFocus
                  spellCheck={false}
                />
                <button className="new-project-confirm" onClick={handleCreateProject}>OK</button>
              </div>
            ) : (
              <button className="add-project-btn" onClick={() => setShowNewProject(true)}>
                + NEW PROJECT
              </button>
            )}
          </div>

          <hr />

          <footer className="sidebar-footer">
            {user ? (
              <div className="auth-profile">
                {user.user_metadata?.avatar_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={user.user_metadata.avatar_url} alt="Profile" className="profile-img" />
                )}
                <div className="profile-info">
                  <span className="profile-name truncate">{user.user_metadata?.full_name || user.email}</span>
                  <button className="logout-btn" onClick={handleLogout}>[ SIGN_OUT ]</button>
                </div>
              </div>
            ) : (
              <button className="login-btn" onClick={handleLogin}>
                [ GOOGLE SIGN_IN ]
              </button>
            )}
            <div className="footer-actions">
              <button className="settings-btn" onClick={() => setSettingsOpen(true)}>
                [ SETTINGS ]
              </button>
              <button className="settings-btn" onClick={() => handleSync(user)} disabled={!user || syncing}>
                {syncing ? '[ SYNCING... ]' : '[ SYNC_NOW ]'}
              </button>
              <span className="status-dot" title={user ? "CONNECTED" : "LOCAL"} style={{ backgroundColor: user ? 'var(--green)' : 'var(--fg-dim)' }} />
            </div>
          </footer>
        </nav>

        {/* ── GRID DIVIDER ── */}
        <div className="grid-divider" />

        {/* ── MAIN ── */}
        <main className="main">
          <header className="header-bar">
            <div className="model-display">
              <samp className="model-label">MODEL:</samp>
              <select
                className="model-select"
                value={model}
                onChange={e => setModel(e.target.value)}
              >
                {filteredModels.map(m => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </div>

            <div className="tab-group">
              <button className={`tab-btn ${tab === 'chat' ? 'active' : ''}`} onClick={() => setTab('chat')}>
                [ CHAT ]
              </button>
              <button className={`tab-btn ${tab === 'graph' ? 'active' : ''}`} onClick={() => setTab('graph')}>
                [ MEMORY ]
              </button>
            </div>
          </header>

          <hr />

          {!activeProject ? (
            /* No project selected state */
            <div className="empty-state">
              <samp className="empty-main">[ NO PROJECT SELECTED ]</samp>
              <samp className="empty-sub">CREATE A PROJECT IN THE SIDEBAR TO BEGIN</samp>
            </div>
          ) : tab === 'chat' ? (
            <>
              <div className="chat-scroll" ref={scrollRef}>
                <div className="msg-list">
                  {currentMessages.map((msg, i) => (
                    <div key={i} className={`msg-block ${msg.role === 'user' ? 'from-user' : ''}`}>
                      <samp className="msg-tag">{tagFor(msg.role)} {msg.timestamp}</samp>
                      <div className="msg-body">
                        <samp>{msg.text}</samp>
                      </div>
                    </div>
                  ))}
                  {loading && (
                    <div className="msg-block">
                      <samp className="msg-tag">{"< PROCESSING >"} {ts()}</samp>
                      <div className="msg-body">
                        <samp className="loading-text">{">>> AWAITING RESPONSE..."}</samp>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <hr />

              <div className="input-zone">
                <div className="skills-bar">
                  <samp className="skills-label">[ SKILLS ]</samp>
                  <button className="skill-btn">IMAGE_GEN</button>
                  <button className="skill-btn">AUDIO_SEQ</button>
                  <button className="skill-btn">VIDEO_RND</button>
                </div>
                <hr />
                <div className="compose-row">
                  <button className="attach-btn" title="Attach file">+</button>
                  <textarea
                    className="compose-input"
                    rows={2}
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    placeholder={loading ? 'PROCESSING...' : 'ENTER COMMAND...'}
                    disabled={loading}
                  />
                  <button
                    className="exec-btn"
                    onClick={handleSend}
                    disabled={!message.trim() || loading}
                  >
                    <span className="exec-label">{loading ? '...' : 'EXEC'}</span>
                    <span className="exec-arrows">{">>>"}</span>
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="graph-container">
                <samp className="graph-badge">[ MEMORY_MAP / {activeProject.name} ]</samp>
                <GraphView projectId={activeProject.id} refreshKey={graphRefresh} />
              </div>

              <hr />

              <div className="input-zone">
                <div className="skills-bar">
                  <samp className="skills-label">[ LEGEND ]</samp>
                  <samp className="legend-item legend-user">■ USER</samp>
                  <samp className="legend-item legend-ai">■ ASSISTANT</samp>
                  <samp className="legend-item legend-sys">■ SYSTEM</samp>
                </div>
              </div>
            </>
          )}
        </main>
      </div>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}
