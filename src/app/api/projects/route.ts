import { NextResponse } from 'next/server';
import { loadSettings, saveSettings, type ProjectEntry } from '@/lib/settings';
import { v4 as uuidv4 } from 'uuid';

// GET — list all projects
export async function GET() {
  const settings = loadSettings();
  return NextResponse.json({ projects: settings.projects });
}

// POST — create a new project
export async function POST(req: Request) {
  try {
    const { name, path: projPath } = await req.json();

    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Project name is required' }, { status: 400 });
    }

    const settings = loadSettings();

    // Check for duplicate name
    if (settings.projects.some(p => p.name.toLowerCase() === name.trim().toLowerCase())) {
      return NextResponse.json({ error: 'Project with this name already exists' }, { status: 409 });
    }

    const newProject: ProjectEntry = {
      id: uuidv4(),
      name: name.trim().toUpperCase().replace(/\s+/g, '-'),
      path: projPath || '',
      createdAt: new Date().toISOString(),
    };

    settings.projects.push(newProject);
    saveSettings(settings);

    return NextResponse.json({ success: true, project: newProject });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE — remove a project
export async function DELETE(req: Request) {
  try {
    const { id } = await req.json();
    const settings = loadSettings();
    settings.projects = settings.projects.filter(p => p.id !== id);
    saveSettings(settings);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
