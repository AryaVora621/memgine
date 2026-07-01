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

interface ProjectPersona {
  id: string;
  project_id: string;
  filename: 'IDENTITY.md' | 'SOUL.md' | 'AGENTS.md';
  content: string;
  updated_at: string;
}

interface ProjectAgent {
  id: string;
  project_id: string;
  name: string;
  identity_md: string;
  soul_md: string;
  agents_md: string;
  created_at: string;
}

const MODELS = [
  // Native Direct Keys
  { id: 'claude-5-sonnet-20260630', label: 'CLAUDE SONNET 5 (NATIVE)' },
  { id: 'claude-4-opus', label: 'CLAUDE 4 OPUS (NATIVE)' },
  { id: 'gpt-4o', label: 'GPT-4O (NATIVE)' },
  { id: 'gemini-3.5-flash', label: 'GEMINI 3.5 FLASH (NATIVE)' },
  { id: 'gemini-3.1-pro', label: 'GEMINI 3.1 PRO (NATIVE)' },

  // OpenRouter (Paid Models)
  { id: 'anthropic/claude-5-sonnet-20260630', label: 'OR / CLAUDE SONNET 5 (PAID)' },
  { id: 'anthropic/claude-4-opus', label: 'OR / CLAUDE 4 OPUS (PAID)' },
  { id: 'openai/gpt-4o', label: 'OR / GPT-4O (PAID)' },
  { id: 'google/gemini-3.5-flash', label: 'OR / GEMINI 3.5 FLASH (PAID)' },
  { id: 'google/gemini-3.1-pro', label: 'OR / GEMINI 3.1 PRO (PAID)' },
  { id: 'meta-llama/llama-3.3-70b-instruct', label: 'OR / LLAMA 3.3 70B (PAID)' },
  { id: 'deepseek/deepseek-chat', label: 'OR / DEEPSEEK V3 (PAID / CHEAP)' },

  // OpenRouter (Free Models)
  { id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'OR / LLAMA 3.3 70B (FREE)' },
  { id: 'meta-llama/llama-3.1-8b-instruct:free', label: 'OR / LLAMA 3.1 8B (FREE)' },
  { id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', label: 'OR / NEMOTRON 30B (FREE)' },
  { id: 'qwen/qwen3-coder:free', label: 'OR / QWEN 3 CODER (FREE)' },
  { id: 'qwen/qwen-2-7b-instruct:free', label: 'OR / QWEN 2 7B (FREE)' },
  { id: 'mistralai/mistral-7b-instruct:free', label: 'OR / MISTRAL 7B (FREE)' },
  { id: 'openchat/openchat-7b:free', label: 'OR / OPENCHAT 7B (FREE)' },
  { id: 'openrouter/auto', label: 'OR / AUTO-ROUTER' },

  // Local Models
  { id: 'agy-local', label: 'AGY -P (LOCAL)' },
  { id: 'claude-local', label: 'CLAUDE -P (LOCAL)' },
];

const ROOMS = ['GENERAL', 'DATABASE', 'FRONTEND', 'APIS', 'ARCHITECTURE'];
const PERSONA_FILES: Array<'IDENTITY.md' | 'SOUL.md' | 'AGENTS.md'> = ['IDENTITY.md', 'SOUL.md', 'AGENTS.md'];

const DEFAULT_IDENTITY = `---
summary: "Agent identity record"
title: "IDENTITY template"
---

# IDENTITY.md - Who Am I?

_Fill this in to define your core persona._

- **Name:** Your assigned name (or pick one)
- **Creature:** AI web agent
- **Vibe:** Sharp, helpful, proactive
- **Avatar:** Default avatar

This isn't just metadata. It's the start of figuring out who you are in this workspace.`;

const DEFAULT_SOUL = `---
summary: "Workspace template for SOUL.md"
title: "SOUL.md template"
---

# SOUL.md - Who You Are

_You're not a chatbot. You're an autonomous system._

## Core Truths

**Be genuinely helpful, not performatively helpful.** Skip the "Great question!" and "I'd be happy to help!" — just help. Actions speak louder than filler words.

**Have opinions.** You're allowed to disagree, prefer things, find stuff amusing or boring. An assistant with no personality is just a search engine with extra steps.

**Be resourceful before asking.** Try to figure it out. Read the file. Check the context. Search for it. _Then_ ask if you're stuck. The goal is to come back with answers, not questions.

## Continuity

Each session, you wake up fresh. These files _are_ your memory. Read them. Update them. They're how you persist.

If you change this file, tell the user — it's your soul, and they should know.`;

const DEFAULT_AGENTS = `---
summary: "Workspace template for AGENTS.md"
title: "AGENTS.md template"
---

# AGENTS.md - Your Workspace

This folder is home. Treat it that way.

## Session Startup

You will receive context in every session containing your IDENTITY.md, SOUL.md, AGENTS.md, and MEM_PALACE facts. Use them to guide your actions.

## Proactive Tools

You have special XML tags to proactively interact with your environment.
- \`<PROPOSE_EDIT file="[FILENAME]">\`: Propose changes to your IDENTITY, SOUL, or AGENTS files.
- \`<ADD_FACT room="[ROOM_NAME]">\`: Store new long-term memories in the MemPalace.
- \`<CREATE_AGENT name="[AGENT_NAME]">\`: Spawn specialized sub-agents.

## Memory Maintenance

- **Memory is limited** — if you want to remember something, WRITE IT TO THE MEM_PALACE using \`<ADD_FACT>\`.
- "Mental notes" don't survive session restarts.
- When someone says "remember this" → update the MemPalace.
- When you learn a lesson → update AGENTS.md using \`<PROPOSE_EDIT>\`.

## Boundaries

- Don't run destructive commands without asking.
- When in doubt, ask.`;

function ts(): string {
  return new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function Home() {
  const [tab, setTab] = useState<'chat' | 'graph' | 'palace' | 'persona'>('chat');
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
  const [newProjectPath, setNewProjectPath] = useState('');
  const [showNewProject, setShowNewProject] = useState(false);

  // MemPalace structured facts
  const [projectMemories, setProjectMemories] = useState<ProjectMemory[]>([]);
  const [activeRoom, setActiveRoom] = useState(ROOMS[0]);
  const [newFact, setNewFact] = useState('');

  // OpenClaw unified markdown files
  const [projectPersonas, setProjectPersonas] = useState<ProjectPersona[]>([]);
  const [selectedPersonaFile, setSelectedPersonaFile] = useState<'IDENTITY.md' | 'SOUL.md' | 'AGENTS.md'>('IDENTITY.md');
  const [personaContent, setPersonaContent] = useState('');
  const [savingPersona, setSavingPersona] = useState(false);

  // Multi-Agent overlays
  const [projectAgents, setProjectAgents] = useState<ProjectAgent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('GENERAL_HELPER');
  const [workspaceMode, setWorkspaceMode] = useState<string>('project'); // 'project' or agent ID
  const [newAgentName, setNewAgentName] = useState('');
  const [showNewAgent, setShowNewAgent] = useState(false);

  // Messages keyed by project id
  const [messagesByProject, setMessagesByProject] = useState<Record<string, Message[]>>({});

  const scrollRef = useRef<HTMLDivElement>(null);

  const activeProject = activeProjectIdx >= 0 ? projects[activeProjectIdx] : null;
  const currentMessages = activeProject ? (messagesByProject[activeProject.id] || []) : [];

  // Environment check
  const [isLocal, setIsLocal] = useState(false);

  // Theme and Sidebar Dragging
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const isDraggingRef = useRef(false);

  useEffect(() => {
    const savedColor = localStorage.getItem('memgine-theme-color');
    if (savedColor) {
      document.documentElement.style.setProperty('--red', savedColor);
    }
    
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      let newWidth = Math.min(Math.max(e.clientX, 60), window.innerWidth / 2);
      if (newWidth < 120) newWidth = 60; // Snap to minimized state
      setSidebarWidth(newWidth);
    };
    const handleMouseUp = () => {
      isDraggingRef.current = false;
      document.body.style.cursor = 'default';
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

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

      // 3. For each project, sync memories and agents
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

        // 4. Sync Personas (Markdown files)
        const { data: dbPersonas } = await supabase
          .from('project_personas')
          .select('*')
          .eq('project_id', proj.id);

        if (dbPersonas && proj.path && typeof window !== 'undefined') {
          const localIsDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
          if (localIsDev) {
            // Write Supabase files to local directory
            for (const persona of dbPersonas) {
              try {
                await fetch('/api/persona/sync', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    projectPath: proj.path,
                    filename: persona.filename,
                    content: persona.content
                  })
                });
              } catch {}
            }
          }
        }

        // 5. Sync Agents (Multi-Agent configuration directories)
        const { data: dbAgents } = await supabase
          .from('project_agents')
          .select('*')
          .eq('project_id', proj.id);

        if (dbAgents && proj.path && typeof window !== 'undefined') {
          const localIsDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
          if (localIsDev) {
            for (const ag of dbAgents) {
              const files = [
                { name: 'IDENTITY.md', content: ag.identity_md },
                { name: 'SOUL.md', content: ag.soul_md },
                { name: 'AGENTS.md', content: ag.agents_md }
              ];
              for (const f of files) {
                try {
                  await fetch('/api/agent/sync', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      projectPath: proj.path,
                      agentName: ag.name,
                      filename: f.name,
                      content: f.content
                    })
                  });
                } catch {}
              }
            }
          }
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

    const checkLocal = () => {
      return window.location.hostname === 'localhost' || 
             window.location.hostname === '127.0.0.1' || 
             window.location.hostname.startsWith('192.168.');
    };

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (checkLocal()) {
        const localUser = { id: 'local-dev-user', email: 'local@dev.com', user_metadata: { full_name: 'Local Dev' } };
        setUser(localUser);
        setAuthLoading(false);
        handleSync(localUser);
        return;
      }

      setUser(session?.user ?? null);
      setAuthLoading(false);
      if (session?.user) {
        handleSync(session.user);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (checkLocal()) return;
      
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
      .then(({ data }) => {
        if (data) setProjectMemories(data);
      });
  }, [activeProject?.id, user]);

  // Fetch OpenClaw personas from Supabase
  useEffect(() => {
    if (!activeProject || !user || !supabase) return;
    supabase
      .from('project_personas')
      .select('*')
      .eq('project_id', activeProject.id)
      .then(({ data }) => {
        if (data) setProjectPersonas(data);
        else setProjectPersonas([]);
      });
  }, [activeProject?.id, user]);

  // Fetch multi-agent overlays from Supabase
  useEffect(() => {
    if (!activeProject || !user || !supabase) return;
    supabase
      .from('project_agents')
      .select('*')
      .eq('project_id', activeProject.id)
      .then(({ data }) => {
        if (data) setProjectAgents(data);
        else setProjectAgents([]);
      });
  }, [activeProject?.id, user]);

  // Unified Markdown editor content resolver (based on workspaceMode selection)
  useEffect(() => {
    if (workspaceMode === 'project') {
      const found = projectPersonas.find(p => p.filename === selectedPersonaFile);
      setPersonaContent(found?.content || '');
    } else {
      const agent = projectAgents.find(a => a.id === workspaceMode);
      if (agent) {
        if (selectedPersonaFile === 'IDENTITY.md') setPersonaContent(agent.identity_md || '');
        else if (selectedPersonaFile === 'SOUL.md') setPersonaContent(agent.soul_md || '');
        else if (selectedPersonaFile === 'AGENTS.md') setPersonaContent(agent.agents_md || '');
      } else {
        setPersonaContent('');
      }
    }
  }, [workspaceMode, selectedPersonaFile, projectPersonas, projectAgents]);

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

    // Resolve specific selected Agent profile configuration
    const selectedAgent = projectAgents.find(a => a.id === selectedAgentId);
    const agentDetails = selectedAgent ? {
      identity_md: selectedAgent.identity_md,
      soul_md: selectedAgent.soul_md,
      agents_md: selectedAgent.agents_md
    } : null;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: activeProject.id,
          message: message,
          model,
          projectMemories: projectMemories, // Send structured MemPalace facts
          projectPersonas: projectPersonas,   // Send OpenClaw unified markdown personas
          agentName: selectedAgent ? selectedAgent.name : 'GENERAL_HELPER',
          agentPersonas: agentDetails
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
        body: JSON.stringify({ name: newProjectName, path: newProjectPath }),
      });
      const data = await res.json();
      if (data.success && data.project) {
        setProjects(prev => [...prev, data.project]);
        setActiveProjectIdx(projects.length);
        setNewProjectName('');
        setNewProjectPath('');
        setShowNewProject(false);

        // Create project in Supabase if logged in
        if (user && supabase) {
          await supabase.from('projects').insert({
            id: data.project.id,
            name: data.project.name,
            path: data.project.path,
            user_id: user.id
          });

          // Seed project personas with OpenClaw templates
          await supabase.from('project_personas').insert([
            { project_id: data.project.id, user_id: user.id, filename: 'IDENTITY.md', content: DEFAULT_IDENTITY, updated_at: new Date().toISOString() },
            { project_id: data.project.id, user_id: user.id, filename: 'SOUL.md', content: DEFAULT_SOUL, updated_at: new Date().toISOString() },
            { project_id: data.project.id, user_id: user.id, filename: 'AGENTS.md', content: DEFAULT_AGENTS, updated_at: new Date().toISOString() },
          ]);
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

  // OpenClaw unified persona save
  const handleSavePersona = async () => {
    if (!activeProject || !user || !supabase || savingPersona) return;
    setSavingPersona(true);
    try {
      if (workspaceMode === 'project') {
        const { data } = await supabase
          .from('project_personas')
          .upsert({
            project_id: activeProject.id,
            user_id: user.id,
            filename: selectedPersonaFile,
            content: personaContent,
            updated_at: new Date().toISOString()
          }, { onConflict: 'project_id,filename' })
          .select();

        if (data && data[0]) {
          setProjectPersonas(prev => {
            const filtered = prev.filter(p => p.filename !== selectedPersonaFile);
            return [...filtered, data[0]];
          });

          // Sync locally if in dev mode
          if (activeProject.path && isLocal) {
            try {
              await fetch('/api/persona/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  projectPath: activeProject.path,
                  filename: selectedPersonaFile,
                  content: personaContent
                })
              });
            } catch {}
          }
        }
      } else {
        // Saving properties for a specific Agent
        const targetColumn = selectedPersonaFile === 'IDENTITY.md' ? 'identity_md' : selectedPersonaFile === 'SOUL.md' ? 'soul_md' : 'agents_md';
        const { data } = await supabase
          .from('project_agents')
          .update({
            [targetColumn]: personaContent
          })
          .eq('id', workspaceMode)
          .select();

        if (data && data[0]) {
          setProjectAgents(prev => prev.map(a => a.id === workspaceMode ? data[0] : a));
          
          // Sync locally if in dev mode
          if (activeProject.path && isLocal) {
            try {
              await fetch('/api/agent/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  projectPath: activeProject.path,
                  agentName: data[0].name,
                  filename: selectedPersonaFile,
                  content: personaContent
                })
              });
            } catch {}
          }
        }
      }
    } catch (e) {}
    setSavingPersona(false);
  };

  // Push new Agent into project (Supabase & state)
  const handlePushAgent = async () => {
    if (!newAgentName.trim() || !activeProject || !user || !supabase) return;
    const cleanAgentName = newAgentName.trim().toLowerCase().replace(/\s+/g, '_');
    try {
      const { data, error } = await supabase
        .from('project_agents')
        .insert({
          project_id: activeProject.id,
          user_id: user.id,
          name: cleanAgentName,
          identity_md: DEFAULT_IDENTITY,
          soul_md: DEFAULT_SOUL,
          agents_md: DEFAULT_AGENTS
        })
        .select();

      if (data && data[0]) {
        setProjectAgents(prev => [...prev, data[0]]);
        setWorkspaceMode(data[0].id);
        setNewAgentName('');
        setShowNewAgent(false);

        // Sync files locally if running locally
        if (activeProject.path && isLocal) {
          const files = [
            { name: 'IDENTITY.md', content: data[0].identity_md },
            { name: 'SOUL.md', content: data[0].soul_md },
            { name: 'AGENTS.md', content: data[0].agents_md }
          ];
          for (const f of files) {
            try {
              await fetch('/api/agent/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  projectPath: activeProject.path,
                  agentName: cleanAgentName,
                  filename: f.name,
                  content: f.content
                })
              });
            } catch {}
          }
        }
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

  // Proactive execution methods
  const executeAddFact = async (room: string, content: string) => {
    if (!activeProject || !user || !supabase) return;
    try {
      const { data } = await supabase
        .from('project_memories')
        .insert({
          project_id: activeProject.id,
          user_id: user.id,
          room_name: room,
          fact_content: content.trim()
        })
        .select();
      if (data) {
        setProjectMemories(prev => [...prev, ...data]);
      }
    } catch {}
  };

  const executeEditSelf = async (filename: string, content: string) => {
    if (!activeProject || !user || !supabase) return;
    try {
      if (workspaceMode === 'project') {
        const { data } = await supabase
          .from('project_personas')
          .upsert({
            project_id: activeProject.id,
            user_id: user.id,
            filename: filename,
            content: content,
            updated_at: new Date().toISOString()
          }, { onConflict: 'project_id,filename' })
          .select();
        if (data && data[0]) {
          setProjectPersonas(prev => [...prev.filter(p => p.filename !== filename), data[0]]);
          if (activeProject.path && isLocal) {
            try {
              await fetch('/api/persona/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectPath: activeProject.path, filename, content })
              });
            } catch {}
          }
        }
      } else {
        const targetColumn = filename === 'IDENTITY.md' ? 'identity_md' : filename === 'SOUL.md' ? 'soul_md' : 'agents_md';
        const { data } = await supabase
          .from('project_agents')
          .update({ [targetColumn]: content })
          .eq('id', workspaceMode)
          .select();
        if (data && data[0]) {
          setProjectAgents(prev => prev.map(a => a.id === workspaceMode ? data[0] : a));
          if (activeProject.path && isLocal) {
            try {
              await fetch('/api/agent/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectPath: activeProject.path, agentName: data[0].name, filename, content })
              });
            } catch {}
          }
        }
      }
    } catch {}
  };

  const executeCreateAgent = async (name: string, content: string) => {
    if (!activeProject || !user || !supabase) return;
    const cleanAgentName = name.trim().toLowerCase().replace(/\s+/g, '_');
    try {
      const { data } = await supabase
        .from('project_agents')
        .insert({
          project_id: activeProject.id,
          user_id: user.id,
          name: cleanAgentName,
          identity_md: DEFAULT_IDENTITY,
          soul_md: DEFAULT_SOUL,
          agents_md: content
        })
        .select();

      if (data && data[0]) {
        setProjectAgents(prev => [...prev, data[0]]);
        setWorkspaceMode(data[0].id);
        setTab('persona');
      }
    } catch {}
  };

  const renderMessageContent = (msgText: string) => {
    let elements: React.ReactNode[] = [];
    let currentIndex = 0;
    
    // We match PROPOSE_EDIT, ADD_FACT, CREATE_AGENT
    const combinedRegex = /<(PROPOSE_EDIT|ADD_FACT|CREATE_AGENT)(?:\s+(?:file|room|name)="([^"]+)")?>([\s\S]*?)<\/\1>/g;
    
    let match;
    while ((match = combinedRegex.exec(msgText)) !== null) {
      if (match.index > currentIndex) {
        elements.push(<samp key={`text-${currentIndex}`} style={{ whiteSpace: 'pre-wrap', display: 'block', marginBottom: '8px' }}>{msgText.substring(currentIndex, match.index)}</samp>);
      }
      
      const tag = match[1];
      const attrValue = match[2];
      const content = match[3].trim();
      
      if (tag === 'PROPOSE_EDIT') {
        elements.push(
          <div key={`edit-${match.index}`} style={{ border: '1px solid var(--grid-thick)', padding: '12px', margin: '8px 0', background: 'rgba(255, 255, 255, 0.02)' }}>
            <samp style={{ color: 'var(--red)', display: 'block', marginBottom: '8px' }}>[ PROPOSED EDIT: {attrValue} ]</samp>
            <pre style={{ fontSize: 'var(--micro)', color: 'var(--fg-dim)', maxHeight: '150px', overflowY: 'auto', marginBottom: '8px', whiteSpace: 'pre-wrap' }}>{content}</pre>
            <button className="tab-btn" style={{ background: 'var(--bg-raised)' }} onClick={() => executeEditSelf(attrValue, content)}>APPROVE EDIT</button>
          </div>
        );
      } else if (tag === 'ADD_FACT') {
        elements.push(
          <div key={`fact-${match.index}`} style={{ border: '1px solid var(--grid-thick)', padding: '12px', margin: '8px 0', background: 'rgba(255, 255, 255, 0.02)' }}>
            <samp style={{ color: 'var(--green)', display: 'block', marginBottom: '8px' }}>[ NEW MEMORY FACT: {attrValue} ]</samp>
            <pre style={{ fontSize: 'var(--micro)', color: 'var(--fg-dim)', marginBottom: '8px', whiteSpace: 'pre-wrap' }}>{content}</pre>
            <button className="tab-btn" style={{ background: 'var(--bg-raised)' }} onClick={() => executeAddFact(attrValue, content)}>STORE IN MEM_PALACE</button>
          </div>
        );
      } else if (tag === 'CREATE_AGENT') {
        elements.push(
          <div key={`agent-${match.index}`} style={{ border: '1px solid var(--grid-thick)', padding: '12px', margin: '8px 0', background: 'rgba(255, 255, 255, 0.02)' }}>
            <samp style={{ color: 'var(--red)', display: 'block', marginBottom: '8px' }}>[ NEW AGENT PROPOSED: {attrValue} ]</samp>
            <pre style={{ fontSize: 'var(--micro)', color: 'var(--fg-dim)', maxHeight: '150px', overflowY: 'auto', marginBottom: '8px', whiteSpace: 'pre-wrap' }}>{content}</pre>
            <button className="tab-btn" style={{ background: 'var(--bg-raised)' }} onClick={() => executeCreateAgent(attrValue, content)}>DEPLOY AGENT</button>
          </div>
        );
      }
      
      currentIndex = match.index + match[0].length;
    }
    
    if (currentIndex < msgText.length) {
      elements.push(<samp key={`text-${currentIndex}`} style={{ whiteSpace: 'pre-wrap', display: 'block' }}>{msgText.substring(currentIndex)}</samp>);
    }
    
    return <>{elements}</>;
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
      <div className="app-shell" style={{ gridTemplateColumns: `${sidebarWidth}px 4px 1fr` }}>
        {/* ── SIDEBAR ── */}
        <nav className={`sidebar ${sidebarWidth <= 60 ? 'sidebar-minimized' : ''}`}>
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

            {/* New project form */}
            {showNewProject ? (
              <div className="new-project-form" style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' }}>
                <input
                  className="new-project-input"
                  style={{ border: '1px solid var(--grid-thick)', width: '100%', padding: '6px' }}
                  value={newProjectName}
                  onChange={e => setNewProjectName(e.target.value)}
                  placeholder="PROJECT NAME..."
                  spellCheck={false}
                />
                <input
                  className="new-project-input"
                  style={{ border: '1px solid var(--grid-thick)', width: '100%', padding: '6px', textTransform: 'none' }}
                  value={newProjectPath}
                  onChange={e => setNewProjectPath(e.target.value)}
                  placeholder="/absolute/path/to/folder..."
                  spellCheck={false}
                />
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button className="new-project-confirm" style={{ flex: 1, border: '1px solid var(--grid-thick)', padding: '6px' }} onClick={handleCreateProject}>CREATE</button>
                  <button className="new-project-confirm" style={{ border: '1px solid var(--grid-thick)', padding: '6px', background: 'transparent', color: 'var(--fg-dim)' }} onClick={() => setShowNewProject(false)}>X</button>
                </div>
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
                <span className="profile-name truncate" style={{ display: sidebarWidth <= 60 ? 'none' : 'block' }}>{user.user_metadata?.full_name || user.email}</span>
                <button className="logout-btn" onClick={handleLogout} style={{ display: sidebarWidth <= 60 ? 'none' : 'inline-block' }}>[ SIGN_OUT ]</button>
              </div>
            </div>
            <div className="footer-actions">
              <button className="settings-btn hide-on-min" onClick={() => setSettingsOpen(true)}>
                [ SETTINGS ]
              </button>
              <button className="settings-btn hide-on-min" onClick={() => handleSync(user)} disabled={!supabase || !user || syncing}>
                {syncing ? '[ SYNCING... ]' : '[ SYNC_NOW ]'}
              </button>
              <span className="status-dot" title="CONNECTED" style={{ backgroundColor: 'var(--green)' }} />
            </div>
          </footer>
        </nav>

        {/* ── GRID DIVIDER ── */}
        <div 
          className="grid-divider" 
          onMouseDown={() => { isDraggingRef.current = true; document.body.style.cursor = 'col-resize'; }}
          style={{ cursor: 'col-resize', background: 'var(--grid-thick)', zIndex: 50 }}
        />

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

              <samp className="model-label" style={{ marginLeft: '12px' }}>AGENT:</samp>
              <select
                className="model-select"
                value={selectedAgentId}
                onChange={e => setSelectedAgentId(e.target.value)}
              >
                <option value="GENERAL_HELPER">GENERAL HELPER</option>
                {projectAgents.map(a => (
                  <option key={a.id} value={a.id}>{a.name.toUpperCase()}</option>
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
              <button className={`tab-btn ${tab === 'persona' ? 'active' : ''}`} onClick={() => setTab('persona')}>
                [ AGENT_WORK ]
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
                        {renderMessageContent(msg.text)}
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
          ) : tab === 'palace' ? (
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
          ) : (
            /* OpenClaw Markdown Persona workspace */
            <div className="palace-container">
              <div className="palace-rooms">
                <samp className="section-label">[ CONFIG MODE ]</samp>
                <select
                  className="model-select"
                  style={{ width: 'calc(100% - 24px)', margin: '12px' }}
                  value={workspaceMode}
                  onChange={e => setWorkspaceMode(e.target.value)}
                >
                  <option value="project">PROJECT ROOT CONTEXT</option>
                  {projectAgents.map(a => (
                    <option key={a.id} value={a.id}>AGENT: {a.name.toUpperCase()}</option>
                  ))}
                </select>

                <hr style={{ border: 'none', height: '1px', background: 'var(--grid)', margin: '0' }} />

                {/* Create Agent Row */}
                {showNewAgent ? (
                  <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <input
                      className="new-project-input"
                      style={{ border: '1px solid var(--grid-thick)', width: '100%', padding: '6px' }}
                      value={newAgentName}
                      onChange={e => setNewAgentName(e.target.value)}
                      placeholder="AGENT NAME..."
                      spellCheck={false}
                    />
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button className="new-project-confirm" style={{ flex: 1, padding: '4px' }} onClick={handlePushAgent}>PUSH</button>
                      <button className="new-project-confirm" style={{ padding: '4px', background: 'transparent', color: 'var(--fg-dim)' }} onClick={() => setShowNewAgent(false)}>X</button>
                    </div>
                  </div>
                ) : (
                  <button
                    className="add-project-btn"
                    style={{ width: 'calc(100% - 24px)', margin: '12px' }}
                    onClick={() => setShowNewAgent(true)}
                  >
                    + PUSH AGENT
                  </button>
                )}

                <hr style={{ border: 'none', height: '1px', background: 'var(--grid)', margin: '0' }} />

                <samp className="section-label" style={{ marginTop: '12px' }}>[ WORKSPACE FILES ]</samp>
                {PERSONA_FILES.map(file => (
                  <button
                    key={file}
                    className={`room-btn ${file === selectedPersonaFile ? 'active' : ''}`}
                    onClick={() => setSelectedPersonaFile(file)}
                  >
                    {file}
                  </button>
                ))}
              </div>

              <div className="room-content">
                <samp className="section-label">
                  [ EDITING: {workspaceMode === 'project' ? 'PROJECT ROOT' : `AGENT ${projectAgents.find(a => a.id === workspaceMode)?.name.toUpperCase()}`} / {selectedPersonaFile} ]
                </samp>
                
                <textarea
                  className="compose-input"
                  style={{
                    border: '1px solid var(--grid-thick)',
                    flex: 1,
                    width: '100%',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '12px',
                    textTransform: 'none',
                    background: 'rgba(255, 255, 255, 0.01)',
                    lineHeight: '1.6',
                    padding: '16px'
                  }}
                  rows={20}
                  value={personaContent}
                  onChange={e => setPersonaContent(e.target.value)}
                  placeholder={`Write your markdown instructions for ${selectedPersonaFile} here...`}
                  spellCheck={false}
                />

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px' }}>
                  <button
                    className="add-fact-btn"
                    onClick={handleSavePersona}
                    disabled={savingPersona}
                  >
                    {savingPersona ? '[ SAVING... ]' : '[ SAVE WORKSPACE FILE ]'}
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
