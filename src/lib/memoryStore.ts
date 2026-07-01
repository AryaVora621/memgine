import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

export interface MemoryNode {
  id: string;
  projectId: string;
  content: string;
  role: 'user' | 'assistant' | 'system';
  timestamp: string;
  metadata: string; // JSON string
  parentId?: string;
}

class MemoryStore {
  private db: any = null;

  constructor(projectId: string) {
    if (process.env.VERCEL === '1') {
      return; // Skip filesystem/database operations on Vercel
    }

    // Save memory in a .notebook directory within the project
    const memDir = path.join(process.cwd(), '.notebook_memories', projectId);
    if (!fs.existsSync(memDir)) {
      try {
        fs.mkdirSync(memDir, { recursive: true });
      } catch (e) {
        console.error('Failed to create local memory directory:', e);
        return;
      }
    }
    
    try {
      // Lazy load better-sqlite3 using require to prevent load/build crashes on serverless (Vercel) envs
      const Database = require('better-sqlite3');
      this.db = new Database(path.join(memDir, 'memory.sqlite'));
      this.init();
    } catch (e) {
      console.error('SQLite initialization bypassed or failed:', e);
    }
  }

  private init() {
    if (!this.db) return;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        projectId TEXT,
        content TEXT,
        role TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        metadata TEXT,
        parentId TEXT
      )
    `);
  }

  public addMemory(projectId: string, content: string, role: 'user' | 'assistant' | 'system', metadata: any = {}, parentId: string | null = null) {
    const id = uuidv4();
    if (!this.db) {
      return id; // Graceful return for Vercel env where SQLite is mocked
    }
    try {
      const stmt = this.db.prepare(
        'INSERT INTO memories (id, projectId, content, role, metadata, parentId) VALUES (?, ?, ?, ?, ?, ?)'
      );
      stmt.run(id, projectId, content, role, JSON.stringify(metadata), parentId);
    } catch {}
    return id;
  }

  public upsertMemory(id: string, projectId: string, content: string, role: 'user' | 'assistant' | 'system', metadata: any = {}, parentId: string | null = null, timestamp: string | null = null) {
    if (!this.db) return id;
    try {
      const stmt = this.db.prepare(
        'INSERT INTO memories (id, projectId, content, role, metadata, parentId, timestamp) VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP)) ON CONFLICT(id) DO UPDATE SET content = EXCLUDED.content, metadata = EXCLUDED.metadata'
      );
      stmt.run(id, projectId, content, role, typeof metadata === 'string' ? metadata : JSON.stringify(metadata), parentId, timestamp);
    } catch {}
    return id;
  }

  public getMemories(projectId: string, limit: number = 50): MemoryNode[] {
    if (!this.db) return [];
    try {
      const stmt = this.db.prepare('SELECT * FROM memories WHERE projectId = ? ORDER BY timestamp DESC LIMIT ?');
      return stmt.all(projectId, limit) as MemoryNode[];
    } catch {
      return [];
    }
  }
  
  public getGraphData(projectId: string) {
    if (!this.db) return { nodes: [], links: [] };
    try {
      const memories = this.getMemories(projectId, 100);
      const nodes = memories.map(m => ({ id: m.id, name: m.role, group: m.role === 'user' ? 1 : 2, val: 3 }));
      const links = memories.filter(m => m.parentId).map(m => ({ source: m.id, target: m.parentId }));
      return { nodes, links };
    } catch {
      return { nodes: [], links: [] };
    }
  }
}

const stores: Record<string, MemoryStore> = {};
export function getMemoryStore(projectId: string) {
  if (!stores[projectId]) {
    stores[projectId] = new MemoryStore(projectId);
  }
  return stores[projectId];
}
