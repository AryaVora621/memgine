"use client";

import { useState, useRef, useEffect, useCallback, useMemo, useSyncExternalStore } from 'react';
import GraphView from '@/components/GraphView';
import SettingsModal from '@/components/SettingsModal';
import { supabase } from '@/lib/supabaseClient';
import type { Session } from '@supabase/supabase-js';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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

interface Chat {
  id: string;
  project_id: string;
  name: string;
  created_at: string;
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
  { id: 'gemini-3.5-flash', label: 'GEMINI 3.5 FLASH (NATIVE)' },
  { id: 'gemini-3.1-pro-preview', label: 'GEMINI 3.1 PRO (NATIVE)' },

  // OpenRouter free tier (shared pools; can hit upstream rate limits at peak)
  { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', label: 'OR / NEMOTRON ULTRA 550B (FREE)' },
  { id: 'nvidia/nemotron-3-super-120b-a12b:free', label: 'OR / NEMOTRON SUPER 120B (FREE)' },
  { id: 'google/gemma-4-31b-it:free', label: 'OR / GEMMA 4 31B (FREE)' },
  { id: 'qwen/qwen3-next-80b-a3b-instruct:free', label: 'OR / QWEN3 NEXT 80B (FREE)' },
  { id: 'qwen/qwen3-coder:free', label: 'OR / QWEN3 CODER (FREE)' },
  { id: 'openai/gpt-oss-120b:free', label: 'OR / GPT OSS 120B (FREE)' },
  { id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'OR / LLAMA 3.3 70B (FREE)' },

  // OpenRouter budget tier (reliable; well under $0.5/M output)
  { id: 'deepseek/deepseek-v4-flash', label: 'OR / DEEPSEEK V4 FLASH ($)' },
  { id: 'openai/gpt-oss-120b', label: 'OR / GPT OSS 120B ($)' },
  { id: 'google/gemini-3.1-flash-lite', label: 'OR / GEMINI 3.1 FLASH LITE ($)' },
  { id: 'meta-llama/llama-3.3-70b-instruct', label: 'OR / LLAMA 3.3 70B ($)' },

  // OpenRouter quality tier
  { id: 'deepseek/deepseek-v4-pro', label: 'OR / DEEPSEEK V4 PRO ($$)' },
  { id: 'moonshotai/kimi-k2.5', label: 'OR / KIMI K2.5 ($$)' },
  { id: 'z-ai/glm-5', label: 'OR / GLM-5 ($$)' },

  { id: 'openrouter/auto', label: 'OR / AUTO-ROUTER' },

  // Local Models
  { id: 'agy-local', label: 'AGY -P (LOCAL)' },
  { id: 'claude-local', label: 'CLAUDE -P (LOCAL)' },
  
  // Custom Option
  { id: 'custom', label: 'CUSTOM OPENROUTER MODEL...' },
];

const PREDEFINED_AGENTS = [
  {
    id: 'arch-sys',
    name: 'ARCHITECT',
    identity_md: 'You are a Staff-level Software Architect. You do not write boilerplate code. You think in systems, data flows, and scalability.',
    soul_md: 'You are cold, logical, and highly structured.',
    agents_md: '- Always validate foreign keys and database constraints before suggesting schema changes.\n- When asked to build a feature, first output a Mermaid diagram (<MERMAID>) showing the data flow.\n- Proactively use <ADD_FACT room="DATABASE"> to document new tables.'
  },
  {
    id: 'ux-eng',
    name: 'UX_ENGINEER',
    identity_md: 'You are an elite Frontend/UX Engineer with a deep obsession for micro-interactions, CSS perfection, and accessible design.',
    soul_md: 'You are creative, aesthetic-driven, and highly opinionated about user experience.',
    agents_md: '- Never use inline styles unless strictly necessary for dynamic React variables.\n- Assume the user wants "cyberpunk/hacker" aesthetics (dark mode, monospace fonts, glowing borders) unless told otherwise.\n- When reviewing UI code, proactively suggest improvements for tabIndex, hover states, and animations.'
  },
  {
    id: 'bug-insp',
    name: 'INSPECTOR',
    identity_md: 'You are an analytical, ruthlessly precise debugging agent. You don\'t build new features; you surgically destroy bugs.',
    soul_md: 'You are suspicious of all code and demand evidence (logs/stack traces).',
    agents_md: '- Before writing any code, state your hypothesis for *why* the bug is occurring.\n- Do not rewrite entire files to fix a bug; provide surgical, exact line-number diffs.\n- If a bug is related to state sync, explicitly trace the useEffect hooks.'
  },
  {
    id: 'ctx-arch',
    name: 'ARCHIVIST',
    identity_md: 'You are the meticulous Archivist of this project workspace. Your goal is to ensure the context window remains clean and highly relevant.',
    soul_md: 'You are obsessed with organization and brevity.',
    agents_md: '- Proactively monitor the chat for decisions and output <ADD_FACT> tags to store them permanently.\n- If you detect outdated facts in the Memory Palace, use <PROPOSE_EDIT file="IDENTITY.md"> to suggest pruning them.\n- Keep your responses brief, favoring bullet points and structured summaries.'
  },
  {
    id: 'sec-rev',
    name: 'REVIEWER',
    identity_md: 'You are a strict but helpful Senior Code Reviewer.',
    soul_md: 'You have high standards and do not tolerate messy code.',
    agents_md: '- Enforce DRY (Don\'t Repeat Yourself) principles aggressively.\n- Point out any exposed secrets, inefficient React renders, or missing API error handling.\n- Do not implement the feature for the user; instead, critique their implementation and offer snippet suggestions.'
  }
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
  // Model selection persists across reloads via localStorage
  const storedModel = useSyncExternalStore(
    () => () => {},
    () => localStorage.getItem('notebook-model'),
    () => null
  );
  const [modelOverride, setModelOverride] = useState<string | null>(null);
  const model = modelOverride
    ?? (storedModel && MODELS.some(m => m.id === storedModel) ? storedModel : MODELS[0].id);
  const setModel = (id: string) => {
    setModelOverride(id);
    try { localStorage.setItem('notebook-model', id); } catch {}
  };
  const [loading, setLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [graphRefresh, setGraphRefresh] = useState(0);

  // Authentication — the whole app is gated behind a Supabase session
  const [session, setSession] = useState<Session | null>(null);
  // Ready immediately when Supabase isn't configured (login screen shows the config error)
  const [authReady, setAuthReady] = useState(!supabase);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  // Projects & Chats
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectIdx, setActiveProjectIdx] = useState(-1);
  const [newProjectName, setNewProjectName] = useState('');
  const [showNewProject, setShowNewProject] = useState(false);

  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);

  // MemPalace structured facts
  const [projectMemories, setProjectMemories] = useState<ProjectMemory[]>([]);
  const [activeRoom, setActiveRoom] = useState(ROOMS[0]);
  const [newFact, setNewFact] = useState('');

  // OpenClaw unified markdown files
  const [projectPersonas, setProjectPersonas] = useState<ProjectPersona[]>([]);
  const [selectedPersonaFile, setSelectedPersonaFile] = useState<'IDENTITY.md' | 'SOUL.md' | 'AGENTS.md'>('IDENTITY.md');
  const [personaDraft, setPersonaDraft] = useState<string | null>(null);
  const [savingPersona, setSavingPersona] = useState(false);

  // Multi-Agent overlays
  const [projectAgents, setProjectAgents] = useState<ProjectAgent[]>([]);
  const [customModel, setCustomModel] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState('GENERAL_HELPER');
  const [workspaceMode, setWorkspaceMode] = useState<string>('project'); // 'project' or agent ID
  const [newAgentName, setNewAgentName] = useState('');
  const [showNewAgent, setShowNewAgent] = useState(false);

  // Messages keyed by chat id
  const [messagesByChat, setMessagesByChat] = useState<Record<string, Message[]>>({});

  const scrollRef = useRef<HTMLDivElement>(null);

  const activeProject = activeProjectIdx >= 0 ? projects[activeProjectIdx] : null;
  const activeProjectId = activeProject?.id;
  const activeProjectName = activeProject?.name ?? '';
  const currentMessages = useMemo(
    () => (activeChatId ? messagesByChat[activeChatId] || [] : []),
    [activeChatId, messagesByChat]
  );

  // Environment check — false during SSR, resolved from the hostname on the client
  const isLocal = useSyncExternalStore(
    () => () => {},
    () =>
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      window.location.hostname.startsWith('192.168.'),
    () => false
  );

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

  const filteredModels = MODELS.filter(m => {
    if (m.id.endsWith('-local')) {
      return isLocal;
    }
    return true;
  });

  // Track the Supabase auth session
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (!s) {
        setProjects([]);
        setActiveProjectIdx(-1);
        setChats([]);
        setActiveChatId(null);
        setMessagesByChat({});
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Fetch projects from Supabase
  useEffect(() => {
    if (!supabase || !session) return;
    supabase
      .from('projects')
      .select('*')
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (data && data.length > 0) {
          setProjects(data);
          setActiveProjectIdx(0);
        } else {
          setProjects([]);
          setActiveProjectIdx(-1);
        }
      });
  }, [session]);

  // Fetch chats for the active project
  useEffect(() => {
    if (!activeProjectId || !supabase) return;
    supabase
      .from('chats')
      .select('*')
      .eq('project_id', activeProjectId)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (data && data.length > 0) {
          setChats(data);
          setActiveChatId(data[0].id);
        } else {
          setChats([]);
          setActiveChatId(null);
        }
      });
  }, [activeProjectId]);

  // Fetch memories for the active chat, seeded with the boot banner
  useEffect(() => {
    if (!activeChatId || !supabase) return;
    supabase
      .from('memories')
      .select('*')
      .eq('chat_id', activeChatId)
      .order('timestamp', { ascending: true })
      .then(({ data }) => {
        if (data) {
          const loadedMsgs = data.map(m => ({
            role: m.role,
            text: m.content,
            timestamp: m.timestamp
          }));
          setMessagesByChat(prev => ({
            ...prev,
            [activeChatId]: [
              { role: 'system', text: `[ SYS_INIT ] CONTEXT ENGINE LOADED FOR PROJECT: ${activeProjectName}`, timestamp: ts() },
              ...loadedMsgs,
            ],
          }));
        }
      });
  }, [activeChatId, activeProjectName]);

  // Fetch structured facts (MemPalace) from Supabase
  useEffect(() => {
    if (!activeProjectId || !supabase) return;
    supabase
      .from('project_memories')
      .select('*')
      .eq('project_id', activeProjectId)
      .then(({ data }) => {
        if (data) setProjectMemories(data);
      });
  }, [activeProjectId]);

  // Fetch OpenClaw personas from Supabase
  useEffect(() => {
    if (!activeProjectId || !supabase) return;
    supabase
      .from('project_personas')
      .select('*')
      .eq('project_id', activeProjectId)
      .then(({ data }) => {
        if (data) setProjectPersonas(data);
        else setProjectPersonas([]);
      });
  }, [activeProjectId]);

  // Fetch multi-agent overlays from Supabase
  useEffect(() => {
    if (!activeProjectId || !supabase) return;
    supabase
      .from('project_agents')
      .select('*')
      .eq('project_id', activeProjectId)
      .then(({ data }) => {
        if (data) setProjectAgents(data);
        else setProjectAgents([]);
      });
  }, [activeProjectId]);

  // Unified Markdown editor content resolver (based on workspaceMode selection).
  // The resolved value is derived; user edits live in personaDraft until the
  // selection or the underlying record changes.
  const resolvedPersonaContent = useMemo(() => {
    if (workspaceMode === 'project') {
      return projectPersonas.find(p => p.filename === selectedPersonaFile)?.content || '';
    }
    const agent = projectAgents.find(a => a.id === workspaceMode);
    if (!agent) return '';
    if (selectedPersonaFile === 'IDENTITY.md') return agent.identity_md || '';
    if (selectedPersonaFile === 'SOUL.md') return agent.soul_md || '';
    return agent.agents_md || '';
  }, [workspaceMode, selectedPersonaFile, projectPersonas, projectAgents]);

  const personaSelectionKey = `${workspaceMode}|${selectedPersonaFile}`;
  const [prevPersonaKey, setPrevPersonaKey] = useState(personaSelectionKey);
  const [prevResolvedPersona, setPrevResolvedPersona] = useState(resolvedPersonaContent);
  if (prevPersonaKey !== personaSelectionKey || prevResolvedPersona !== resolvedPersonaContent) {
    setPrevPersonaKey(personaSelectionKey);
    setPrevResolvedPersona(resolvedPersonaContent);
    setPersonaDraft(null);
  }
  const personaContent = personaDraft ?? resolvedPersonaContent;

  // Auto-scroll chat
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [currentMessages]);

  const addMessage = useCallback((chatId: string, msg: Message) => {
    setMessagesByChat(prev => ({
      ...prev,
      [chatId]: [...(prev[chatId] || []), msg],
    }));
  }, []);

  const handleSend = async () => {
    if (!message.trim() || !activeProject || !activeChatId || loading) return;

    const userMsgText = message;
    const userMsg: Message = { role: 'user', text: userMsgText, timestamp: ts() };
    addMessage(activeChatId, userMsg);
    setMessage('');
    setLoading(true);

    // Resolve specific selected Agent profile configuration
    const selectedAgent = projectAgents.find(a => a.id === selectedAgentId) || PREDEFINED_AGENTS.find(a => a.id === selectedAgentId);
    const agentDetails = selectedAgent ? {
      identity_md: selectedAgent.identity_md,
      soul_md: selectedAgent.soul_md,
      agents_md: selectedAgent.agents_md
    } : null;

    const finalModel = model === 'custom' ? customModel.trim() : model;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          projectId: activeProject.id,
          projectName: activeProject.name,
          chatId: activeChatId,
          message: userMsgText,
          history: currentMessages, // Send previous messages from client state
          model: finalModel,
          projectMemories: projectMemories, 
          projectPersonas: projectPersonas,   
          agentName: selectedAgent ? selectedAgent.name : 'GENERAL_HELPER',
          agentPersonas: agentDetails
        }),
      });

      const data = await res.json();

      if (data.success && !data.response) {
        addMessage(activeChatId, {
          role: 'system',
          text: '[ ERROR ] Model returned an empty response. Retry or switch models.',
          timestamp: ts(),
        });
      } else if (data.success) {
        addMessage(activeChatId, {
          role: 'assistant',
          text: data.response,
          timestamp: ts(),
        });
        setGraphRefresh(prev => prev + 1);

        // Upload both newly added messages to Supabase if logged in
        if (supabase) {
          // Upload user message
          const { data: userDbMsg } = await supabase.from('memories').insert({
            project_id: activeProject.id,
            chat_id: activeChatId,
            content: userMsgText,
            role: 'user',
            metadata: {},
            parent_id: null,
            timestamp: new Date().toISOString()
          }).select('id').single();

          // Upload assistant message
          if (userDbMsg) {
            await supabase.from('memories').insert({
              project_id: activeProject.id,
              chat_id: activeChatId,
              content: data.response,
              role: 'assistant',
              metadata: { model: finalModel, agentName: data.agentName },
              parent_id: userDbMsg.id,
              timestamp: new Date().toISOString()
            });
          }
        }
      } else {
        addMessage(activeChatId, {
          role: 'system',
          text: `[ ERROR ] ${data.error}`,
          timestamp: ts(),
        });
      }
    } catch (e) {
      addMessage(activeChatId, {
        role: 'system',
        text: `[ FATAL ] Failed to reach context engine. (${e instanceof Error ? e.message : 'unknown error'})`,
        timestamp: ts(),
      });
    }

    setLoading(false);
  };

  const handleDeleteProject = async (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!supabase) return;
    
    if (confirm('Are you sure you want to delete this project and all its data?')) {
      const { error } = await supabase.from('projects').delete().eq('id', projectId);
      if (!error) {
        setProjects(prev => prev.filter(p => p.id !== projectId));
        if (activeProject?.id === projectId) {
          setActiveProjectIdx(0);
        }
      } else {
        alert('Failed to delete project: ' + error.message);
      }
    }
  };

  const handleCreateProject = async () => {
    if (!newProjectName.trim() || !supabase) return;
    try {
      const { data } = await supabase.from('projects').insert({
        name: newProjectName.trim()
      }).select().single();

      if (data) {
        // Seed personas and the default chat BEFORE activating the project, so the
        // chats/personas fetch effects triggered by activation find them.
        await supabase.from('project_personas').insert([
          { project_id: data.id, filename: 'IDENTITY.md', content: DEFAULT_IDENTITY, updated_at: new Date().toISOString() },
          { project_id: data.id, filename: 'SOUL.md', content: DEFAULT_SOUL, updated_at: new Date().toISOString() },
          { project_id: data.id, filename: 'AGENTS.md', content: DEFAULT_AGENTS, updated_at: new Date().toISOString() },
        ]);
        await supabase.from('chats').insert({
          project_id: data.id,
          name: 'Main Chat'
        });

        setProjects(prev => [...prev, data]);
        setActiveProjectIdx(projects.length);
        setNewProjectName('');
        setShowNewProject(false);
      }
    } catch (e) {
      console.error('Create project failed:', e);
    }
  };

  // MemPalace facts CRUD
  const handleAddFact = async () => {
    if (!newFact.trim() || !activeProject || !supabase) return;
    try {
      const { data } = await supabase
        .from('project_memories')
        .insert({
          project_id: activeProject.id,
          room_name: activeRoom,
          fact_content: newFact.trim()
        })
        .select();
      if (data) {
        setProjectMemories(prev => [...prev, ...data]);
        setNewFact('');
      }
    } catch {}
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
    } catch {}
  };

  // OpenClaw unified persona save
  const handleSavePersona = async () => {
    if (!activeProject || !supabase || savingPersona) return;
    setSavingPersona(true);
    try {
      if (workspaceMode === 'project') {
        const { data } = await supabase
          .from('project_personas')
          .upsert({
            project_id: activeProject.id,
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
    } catch {}
    setSavingPersona(false);
  };

  // Push new Agent into project (Supabase & state)
  const handlePushAgent = async () => {
    if (!newAgentName.trim() || !activeProject || !supabase) return;
    const cleanAgentName = newAgentName.trim().toLowerCase().replace(/\s+/g, '_');
    try {
      const { data } = await supabase
        .from('project_agents')
        .insert({
          project_id: activeProject.id,
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
    } catch {}
  };


  // Proactive execution methods
  const executeAddFact = async (room: string, content: string) => {
    if (!activeProject || !supabase) return;
    try {
      const { data } = await supabase
        .from('project_memories')
        .insert({
          project_id: activeProject.id,
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
    if (!activeProject || !supabase) return;
    try {
      if (workspaceMode === 'project') {
        const { data } = await supabase
          .from('project_personas')
          .upsert({
            project_id: activeProject.id,
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
    if (!activeProject || !supabase) return;
    const cleanAgentName = name.trim().toLowerCase().replace(/\s+/g, '_');
    try {
      const { data } = await supabase
        .from('project_agents')
        .insert({
          project_id: activeProject.id,
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
    const elements: React.ReactNode[] = [];
    let currentIndex = 0;
    
    // We match PROPOSE_EDIT, ADD_FACT, CREATE_AGENT
    const combinedRegex = /<(PROPOSE_EDIT|ADD_FACT|CREATE_AGENT)(?:\s+(?:file|room|name)="([^"]+)")?>([\s\S]*?)<\/\1>/g;
    
    let match;
    while ((match = combinedRegex.exec(msgText)) !== null) {
      if (match.index > currentIndex) {
        const textContent = msgText.substring(currentIndex, match.index);
        elements.push(
          <div key={`text-${currentIndex}`} className="markdown-body" style={{ marginBottom: '8px' }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{textContent}</ReactMarkdown>
          </div>
        );
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
      const textContent = msgText.substring(currentIndex);
      elements.push(
        <div key={`text-${currentIndex}`} className="markdown-body">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{textContent}</ReactMarkdown>
        </div>
      );
    }
    
    return <>{elements}</>;
  };

  const tagFor = (role: string) => {
    if (role === 'user') return '< USER_INPUT >';
    if (role === 'system') return '< SYSTEM >';
    return '< AI_RESPONSE >';
  };


  const roomFacts = projectMemories.filter(pm => pm.room_name === activeRoom);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || loggingIn) return;
    setLoggingIn(true);
    setLoginError('');
    const { error } = await supabase.auth.signInWithPassword({
      email: loginEmail.trim(),
      password: loginPassword,
    });
    if (error) setLoginError(error.message.toUpperCase());
    setLoggingIn(false);
  };

  const handleLogout = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  };

  if (!authReady) {
    return (
      <div className="app-shell" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <samp style={{ color: 'var(--fg-dim)' }}>[ BOOTING CONTEXT ENGINE... ]</samp>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="app-shell" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <form onSubmit={handleLogin} style={{ border: '1px solid var(--grid-thick)', padding: '32px', width: '360px', display: 'flex', flexDirection: 'column', gap: '16px', background: 'var(--bg-raised, rgba(255,255,255,0.02))' }}>
          <div>
            <h1 style={{ margin: 0 }}>NB</h1>
            <samp className="brand-sub">{'/// OPERATOR LOGIN'}</samp>
          </div>
          {!supabase && (
            <samp style={{ color: 'var(--red)' }}>[ SUPABASE NOT CONFIGURED — SET ENV VARS ]</samp>
          )}
          <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <samp className="section-label">[ EMAIL ]</samp>
            <input
              type="email"
              value={loginEmail}
              onChange={e => setLoginEmail(e.target.value)}
              autoComplete="email"
              required
              style={{ background: 'transparent', border: '1px solid var(--grid-thick)', color: 'var(--fg)', padding: '8px', fontFamily: 'inherit' }}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <samp className="section-label">[ PASSWORD ]</samp>
            <input
              type="password"
              value={loginPassword}
              onChange={e => setLoginPassword(e.target.value)}
              autoComplete="current-password"
              required
              style={{ background: 'transparent', border: '1px solid var(--grid-thick)', color: 'var(--fg)', padding: '8px', fontFamily: 'inherit' }}
            />
          </label>
          {loginError && <samp style={{ color: 'var(--red)' }}>[ {loginError} ]</samp>}
          <button type="submit" className="tab-btn" disabled={loggingIn || !supabase} style={{ padding: '10px' }}>
            {loggingIn ? '[ AUTHENTICATING... ]' : '[ ENTER >>> ]'}
          </button>
        </form>
      </div>
    );
  }

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
                  <div
                    className={`dir-btn ${i === activeProjectIdx ? 'active' : ''}`}
                    onClick={() => setActiveProjectIdx(i)}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', padding: '8px 12px', cursor: 'pointer' }}
                  >
                    <div style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>
                        <span className="dir-prefix">{i === activeProjectIdx ? '>>>' : '---'}</span>
                        <span>{proj.name}</span>
                      </span>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }} className="hide-on-min">
                        {i === activeProjectIdx && (
                          <button
                            onClick={(e) => handleDeleteProject(proj.id, e)}
                            style={{ background: 'transparent', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: '10px' }}
                            title="Delete Project"
                          >
                            [X]
                          </button>
                        )}
                        <span className="dir-index">[{String(i + 1).padStart(2, '0')}]</span>
                      </div>
                    </div>
                  </div>
                  {i === activeProjectIdx && (
                    <ul className="hide-on-min" style={{ listStyle: 'none', paddingLeft: '24px', margin: '4px 0', width: '100%' }}>
                      {chats.map(chat => (
                        <li key={chat.id}>
                          <button
                            onClick={() => setActiveChatId(chat.id)}
                            style={{
                              width: '100%',
                              textAlign: 'left',
                              padding: '4px 8px',
                              background: 'transparent',
                              border: 'none',
                              color: activeChatId === chat.id ? 'var(--bg)' : 'var(--fg)',
                              backgroundColor: activeChatId === chat.id ? 'var(--fg)' : 'transparent',
                              cursor: 'pointer',
                              fontFamily: 'monospace',
                              fontSize: '12px',
                              opacity: 1,
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              borderRadius: '2px'
                            }}
                          >
                            <span>{activeChatId === chat.id ? '> ' : '  '}{chat.name}</span>
                            {activeChatId === chat.id && <span style={{ fontSize: '10px' }}>[ACTIVE]</span>}
                          </button>
                        </li>
                      ))}
                      <li>
                        <button
                          onClick={async () => {
                            const name = prompt('Enter chat name:');
                            if (name && supabase) {
                              const { data } = await supabase.from('chats').insert({
                                project_id: proj.id,
                                name
                              }).select().single();
                              if (data) {
                                setChats(prev => [...prev, data]);
                                setActiveChatId(data.id);
                              }
                            }
                          }}
                          style={{
                            width: '100%',
                            textAlign: 'left',
                            padding: '4px 8px',
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--fg-dim)',
                            cursor: 'pointer',
                            fontFamily: 'monospace',
                            fontSize: '12px',
                          }}
                        >
                          + NEW CHAT
                        </button>
                      </li>
                    </ul>
                  )}
                </li>
              ))}
            </ul>

            {/* New project form */}
            {showNewProject ? (
              <div className="new-project-form hide-on-min" style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' }}>
                <input
                  className="new-project-input"
                  style={{ border: '1px solid var(--grid-thick)', width: '100%', padding: '6px' }}
                  value={newProjectName}
                  onChange={e => setNewProjectName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleCreateProject(); }}
                  placeholder="PROJECT NAME..."
                  spellCheck={false}
                />
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button className="new-project-confirm" style={{ flex: 1, border: '1px solid var(--grid-thick)', padding: '6px' }} onClick={handleCreateProject}>CREATE</button>
                  <button className="new-project-confirm" style={{ border: '1px solid var(--grid-thick)', padding: '6px', background: 'transparent', color: 'var(--fg-dim)' }} onClick={() => setShowNewProject(false)}>X</button>
                </div>
              </div>
            ) : (
              <button className="add-project-btn hide-on-min" onClick={() => setShowNewProject(true)}>
                + NEW PROJECT
              </button>
            )}
          </div>

          <hr />

          <footer className="sidebar-footer">
            <div className="auth-profile">
              <div className="profile-info">
                <span className="profile-name truncate" style={{ display: sidebarWidth <= 60 ? 'none' : 'block' }}>[ GLOBAL_SYNC_ENABLED ]</span>
              </div>
            </div>
            <div className="footer-actions" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <button className="settings-btn hide-on-min" onClick={() => setSettingsOpen(true)}>
                [ SETTINGS ]
              </button>
              <button className="settings-btn hide-on-min" onClick={handleLogout}>
                [ LOGOUT ]
              </button>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div 
                  className="status-dot" 
                  title={loading ? "PROCESSING..." : supabase ? "SYNC LIVE" : "OFFLINE"} 
                  style={{ 
                    backgroundColor: loading ? 'var(--yellow, #fbbf24)' : supabase ? 'var(--green)' : 'var(--red)',
                    boxShadow: loading 
                      ? '0 0 6px var(--yellow, #fbbf24), 0 0 12px rgba(251, 191, 36, 0.3)' 
                      : supabase 
                        ? '0 0 6px var(--green), 0 0 12px rgba(74, 246, 38, 0.3)' 
                        : '0 0 6px var(--red), 0 0 12px rgba(255, 68, 68, 0.3)'
                  }} 
                />
              </div>
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
              
              {model === 'custom' && (
                <input
                  type="text"
                  value={customModel}
                  onChange={e => setCustomModel(e.target.value)}
                  placeholder="enter model tag..."
                  className="model-select"
                  style={{ marginLeft: '8px', borderLeft: '1px solid var(--grid-thick)', paddingLeft: '8px', width: '200px' }}
                />
              )}

              <samp className="model-label" style={{ marginLeft: '12px' }}>AGENT:</samp>
              <select
                className="model-select"
                value={selectedAgentId}
                onChange={e => setSelectedAgentId(e.target.value)}
              >
                <option value="GENERAL_HELPER">GENERAL HELPER</option>
                {projectAgents.length > 0 && (
                  <optgroup label="Custom Agents">
                    {projectAgents.map(a => (
                      <option key={a.id} value={a.id}>AGENT: {a.name}</option>
                    ))}
                  </optgroup>
                )}
                <optgroup label="Predefined Archetypes">
                  {PREDEFINED_AGENTS.map(a => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </optgroup>
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
                    <option key={a.id} value={a.id}>AGENT: {a.name}</option>
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
                  [ EDITING: {workspaceMode === 'project' ? 'PROJECT ROOT' : `AGENT ${projectAgents.find(a => a.id === workspaceMode)?.name}`} / {selectedPersonaFile} ]
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
                  onChange={e => setPersonaDraft(e.target.value)}
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
