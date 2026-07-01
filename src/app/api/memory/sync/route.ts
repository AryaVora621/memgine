import { NextResponse } from 'next/server';
import { getMemoryStore } from '@/lib/memoryStore';

export async function POST(req: Request) {
  try {
    const { projectId, memories } = await req.json();

    if (!projectId || !Array.isArray(memories)) {
      return NextResponse.json({ error: 'projectId and memories array are required' }, { status: 400 });
    }

    const memory = getMemoryStore(projectId);

    // Batch upsert memories locally
    memories.forEach((m: any) => {
      memory.upsertMemory(
        m.id,
        projectId,
        m.content,
        m.role,
        m.metadata,
        m.parent_id || m.parentId || null,
        m.timestamp || m.created_at || null
      );
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
