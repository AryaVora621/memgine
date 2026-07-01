import Database from 'better-sqlite3';
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
  private db: Database.Database;

  constructor(projectId: string) {
    // Save memory in a .notebook directory within the project (or a central location for this MVP)
    const memDir = path.join(process.cwd(), '.notebook_memories', projectId);
    if (!fs.existsSync(memDir)) {
      fs.mkdirSync(memDir, { recursive: true });
    }
    
    this.db = new Database(path.join(memDir, 'memory.sqlite'));
    this.init();
  }

  private init() {
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
    const stmt = this.db.prepare(
      'INSERT INTO memories (id, projectId, content, role, metadata, parentId) VALUES (?, ?, ?, ?, ?, ?)'
    );
    stmt.run(id, projectId, content, role, JSON.stringify(metadata), parentId);
    return id;
  }

  public upsertMemory(id: string, projectId: string, content: string, role: 'user' | 'assistant' | 'system', metadata: any = {}, parentId: string | null = null, timestamp: string | null = null) {
    const stmt = this.db.prepare(
      'INSERT INTO memories (id, projectId, content, role, metadata, parentId, timestamp) VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP)) ON CONFLICT(id) DO UPDATE SET content = EXCLUDED.content, metadata = EXCLUDED.metadata'
    );
    stmt.run(id, projectId, content, role, typeof metadata === 'string' ? metadata : JSON.stringify(metadata), parentId, timestamp);
    return id;
  }

  public getMemories(projectId: string, limit: number = 50): MemoryNode[] {
    const stmt = this.db.prepare('SELECT * FROM memories WHERE projectId = ? ORDER BY timestamp DESC LIMIT ?');
    return stmt.all(projectId, limit) as MemoryNode[];
  }
  
  public getGraphData(projectId: string) {
    const memories = this.getMemories(projectId, 100);
    // Transform into nodes and links for react-force-graph
    const nodes = memories.map(m => ({ id: m.id, name: m.role, group: m.role === 'user' ? 1 : 2, val: 3 }));
    const links = memories.filter(m => m.parentId).map(m => ({ source: m.id, target: m.parentId }));
    return { nodes, links };
  }
}

// Simple factory/cache
const stores: Record<string, MemoryStore> = {};
export function getMemoryStore(projectId: string) {
  if (!stores[projectId]) {
    stores[projectId] = new MemoryStore(projectId);
  }
  return stores[projectId];
}
