import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function POST(req: Request) {
  try {
    const { projectPath, filename, content } = await req.json();

    if (!projectPath || !filename || content === undefined) {
      return NextResponse.json({ error: 'projectPath, filename, and content are required' }, { status: 400 });
    }

    if (process.env.VERCEL === '1') {
      return NextResponse.json({ success: true, message: 'Bypassed on serverless' });
    }

    // Resolve directory and write file locally to sync with Supabase
    if (fs.existsSync(projectPath)) {
      const filePath = path.join(projectPath, filename);
      fs.writeFileSync(filePath, content, 'utf-8');
      return NextResponse.json({ success: true });
    } else {
      return NextResponse.json({ error: 'Local folder path does not exist' }, { status: 400 });
    }

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
