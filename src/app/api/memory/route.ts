import { NextResponse } from 'next/server';
import { getMemoryStore } from '@/lib/memoryStore';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get('projectId');

  if (!projectId) {
    return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
  }

  try {
    const memory = getMemoryStore(projectId);
    const memories = memory.getMemories(projectId, 200);

    // Build nodes and links for the graph
    // Each memory entry becomes a node; parentId links form edges
    const nodes = memories.map(m => ({
      id: m.id,
      label: m.role === 'user'
        ? (m.content.length > 40 ? m.content.substring(0, 40) + '...' : m.content)
        : (m.content.length > 40 ? m.content.substring(0, 40) + '...' : m.content),
      role: m.role,
      group: m.role === 'user' ? 1 : m.role === 'assistant' ? 2 : 3,
      val: m.role === 'user' ? 4 : 5,
      timestamp: m.timestamp,
      fullContent: m.content,
    }));

    const links = memories
      .filter(m => m.parentId)
      .map(m => ({
        source: m.parentId!,
        target: m.id,
      }));

    return NextResponse.json({ nodes, links });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
