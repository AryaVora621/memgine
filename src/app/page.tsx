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

interface ProjectMemory {
  id: string;
  project_id: string;
  room_name: string;
  fact_content: string;
  created_at: string;
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

const ROOMS = ['GENERAL', 'DATABASE', 'FRONTEND', 'APIS', 'ARCHITECTURE'];

function ts(): string {
  return new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function Home() {
  const [tab, setTab] = useState<'chat' | 'graph' | 'palace'>('chat');
  const [message, setMessage] = useState('');
  const [model, setModel] = useState(MODELS[0].id);
  const [loading, setLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [graphRefresh, setGraphRefresh] = useState(0);

  // Authentication
  const [user, setUser] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  // Projects
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectIdx, setActiveProjectIdx] = useState(-1);
  const [newProjectName, setNewProjectName] = useState('');
  const [showNewProject, setShowNewProject] = useState(false);

  // MemPalace structured facts
  const [projectMemories, setProjectMemories] = useState<ProjectMemory[]>([]);
  const [activeRoom, setActiveRoom] = useState(ROOMS[0]);
  const [newFact, setNewFact] = useState('');

  // Messages keyed by project id
  const [messagesByProject, setMessagesByProject] = useState<Record<string, Message[]>>({});

  const scrollRef = useRef<HTMLDivElement>(null);

  const activeProject = activeProjectIdx >= 0 ? projects[activeProjectIdx] : null;
  const currentMessages = activeProject ? (messagesByProject[activeProject.id] || []) : [];

  // Environment check
  const [isLocal, setIsLocal] = useState(false);

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
    if (!currentUser || !supabase) return;
    setSyncing(true);
    try {
      // 1. Fetch projects from local backend
      const localProjects: Project[] = [];
      try {
        const localRes = await fetch('/api/projects');
        const localData = await localRes.json();
        if (localData.projects) localProjects.push(...localData.projects);
      } catch {}

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
          try {
            const res = await fetch('/api/projects', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: dbProj.name, path: dbProj.path, id: dbProj.id }),
            });
            const data = await res.json();
            if (data.success && data.project) {
              localUpdatedList.push(data.project);
            }
          } catch {}
        }
      }
      setProjects(localUpdatedList);

      // 3. For each project, sync memories
      for (const proj of localUpdatedList) {
        let localMemories: any[] = [];
        try {
          const memRes = await fetch(`/api/memory?projectId=${proj.id}`);
          const memData = await memRes.json();
          if (memData.nodes) localMemories = memData.nodes;
        } catch {}

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
          try {
            await fetch('/api/memory/sync', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                projectId: proj.id,
                memories: missingLocally
              })
            });
          } catch {}
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
    if (!supabase) {
      setAuthLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
      if (session?.user) {
        handleSync(session.user);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
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

  // Fetch structured facts (MemPalace) from Supabase
  useEffect(() => {
    if (!activeProject || !user || !supabase) return;
    supabase
      .from('project_memories')
      .select('*')
      .eq('project_id', activeProject.id)
      .then(({ data, error }) => {
        if (data) setProjectMemories(data);
      });
  }, [activeProject?.id, user]);

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
          projectMemories: projectMemories // Send structured MemPalace facts
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
        if (user && supabase) {
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
        if (user && supabase) {
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

  // MemPalace facts CRUD
  const handleAddFact = async () => {
    if (!newFact.trim() || !activeProject || !user || !supabase) return;
    try {
      const { data, error } = await supabase
        .from('project_memories')
        .insert({
          project_id: activeProject.id,
          user_id: user.id,
          room_name: activeRoom,
          fact_content: newFact.trim()
        })
        .select();
      if (data) {
        setProjectMemories(prev => [...prev, ...data]);
        setNewFact('');
      }
    } catch (e) {}
  };

  const handleDeleteFact = async (factId: string) => {
    if (!supabase) return;
    try {
      const { error } = await supabase
        .from('project_memories')
        .delete()
        .eq('id', factId);
      if (!error) {
        setProjectMemories(prev => prev.filter(f => f.id !== factId));
      }
    } catch (e) {}
  };

  const handleLogin = async () => {
    if (!supabase) return;
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin
      }
    });
  };

  const handleLogout = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setUser(null);
  };

  const tagFor = (role: string) => {
    if (role === 'user') return '< USER_INPUT >';
    if (role === 'system') return '< SYSTEM >';
    return '< AI_RESPONSE >';
  };

  // Render Full Auth Wall if not authenticated
  if (authLoading) {
    return (
      <div className="auth-wall">
        <div className="auth-card crosshairs">
          <h1 className="text-white">NB_</h1>
          <samp className="brand-sub">{"/// MEMGINE (MEMORY ENGINE)"}</samp>
          <hr className="auth-hr" />
          <samp className="loading-text">{">>> SYSTEM RESOLVING AUTHENTICATION..."}</samp>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="auth-wall">
        <div className="auth-card crosshairs">
          <h1>NB</h1>
          <samp className="brand-sub">{"/// MEMGINE (MEMORY ENGINE)"}</samp>
          <hr className="auth-hr" />
          <p className="auth-desc">NOTEBOOK PROJECTS CONTEXT SYSTEM AND PERSISTENT MEMORY MODULE.</p>
          {!supabase ? (
            <div className="login-btn" style={{ opacity: 0.5, cursor: 'not-allowed', marginTop: '20px' }}>
              [ SYNC DISABLED - CONFIGURE SUPABASE ENV VARIABLES ]
            </div>
          ) : (
            <button className="login-btn" onClick={handleLogin} style={{ marginTop: '20px', padding: '12px' }}>
              [ SIGN_IN WITH GOOGLE ]
            </button>
          )}
        </div>
      </div>
    );
  }

  const roomFacts = projectMemories.filter(pm => pm.room_name === activeRoom);

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
            <div className="footer-actions">
              <button className="settings-btn" onClick={() => setSettingsOpen(true)}>
                [ SETTINGS ]
              </button>
              <button className="settings-btn" onClick={() => handleSync(user)} disabled={!supabase || !user || syncing}>
                {syncing ? '[ SYNCING... ]' : '[ SYNC_NOW ]'}
              </button>
              <span className="status-dot" title="CONNECTED" style={{ backgroundColor: 'var(--green)' }} />
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
                [ MEMORY_MAP ]
              </button>
              <button className={`tab-btn ${tab === 'palace' ? 'active' : ''}`} onClick={() => setTab('palace')}>
                [ MEM_PALACE ]
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
          ) : tab === 'graph' ? (
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
          ) : (
            /* MemPalace structured facts workspace */
            <div className="palace-container">
              <div className="palace-rooms">
                <samp className="section-label">[ PALACE ROOMS ]</samp>
                {ROOMS.map(room => (
                  <button
                    key={room}
                    className={`room-btn ${room === activeRoom ? 'active' : ''}`}
                    onClick={() => setActiveRoom(room)}
                  >
                    {room}
                  </button>
                ))}
              </div>

              <div className="room-content">
                <samp className="section-label">[ PERSISTENT FACTS IN ROOM: {activeRoom} ]</samp>
                
                <div className="facts-list">
                  {roomFacts.length === 0 ? (
                    <samp className="empty-sub">NO FACTS CURRENTLY PERSISTED IN THIS LOCI.</samp>
                  ) : (
                    roomFacts.map(fact => (
                      <div className="fact-item" key={fact.id}>
                        <div className="fact-text">{fact.fact_content}</div>
                        <button className="delete-fact-btn" onClick={() => handleDeleteFact(fact.id)}>
                          [ DELETE ]
                        </button>
                      </div>
                    ))
                  )}
                </div>

                <div className="add-fact-row" style={{ marginTop: 'auto' }}>
                  <input
                    className="fact-input"
                    value={newFact}
                    onChange={e => setNewFact(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleAddFact(); }}
                    placeholder={`PERSIST FACT IN ${activeRoom}...`}
                    spellCheck={false}
                  />
                  <button className="add-fact-btn" onClick={handleAddFact}>
                    [ PERSIST ]
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}
