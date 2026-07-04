import os from 'os';
import { exec } from 'child_process';
import { authedClient } from '@/lib/serverSupabase';
import { isDangerousLocalCommand } from '@/lib/tags';

// RUN_LOCAL execution: runs a real shell command on whatever machine this
// Next.js server process is actually running on. That is the operator's own
// laptop ONLY when they started the app themselves via `npm run dev` — if
// this route is ever reached on a hosted deployment (Vercel or otherwise) it
// would be running on that host's infrastructure instead, which is not what
// "local" means here. The two checks below are both required, independently
// of each other and of anything the client sends, so a compromised or buggy
// client can't turn this on where it shouldn't be:
//   1. process.env.VERCEL is set by Vercel on every deployment (prod AND
//      preview) — refuse unconditionally if present.
//   2. LOCAL_EXEC_ENABLED must be explicitly set to 'true' in .env.local.
//      Never set this in a hosted environment's env vars.
const MAX_BUFFER = 2 * 1024 * 1024; // 2MB of combined stdout+stderr
const TIMEOUT_MS = 2 * 60 * 1000;

function localExecAllowed() {
  return !process.env.VERCEL && process.env.LOCAL_EXEC_ENABLED === 'true';
}

export async function POST(req: Request) {
  if (!localExecAllowed()) {
    return Response.json({
      success: false,
      error: 'LOCAL_EXEC_DISABLED: set LOCAL_EXEC_ENABLED=true in .env.local on the machine running `npm run dev` to enable RUN_LOCAL. Never enabled on a hosted deployment.',
    }, { status: 403 });
  }

  const auth = await authedClient(req);
  if (auth === 'unauthorized' || auth === null) {
    return Response.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 });
  }
  const { db } = auth;

  const { projectId, chatId, command, cwd, confirmed } = await req.json();
  if (!command || typeof command !== 'string') {
    return Response.json({ success: false, error: 'command is required' }, { status: 400 });
  }

  if (isDangerousLocalCommand(command) && confirmed !== true) {
    return Response.json({
      success: false,
      error: 'CONFIRMATION_REQUIRED: this command matches a destructive pattern (rm -rf, sudo, force-push, etc.) and must be confirmed by a manual click, even with auto-accept on.',
    }, { status: 400 });
  }

  const workingDir = typeof cwd === 'string' && cwd.trim() ? cwd.trim() : os.homedir();

  const text = await new Promise<string>((resolve) => {
    exec(command, { cwd: workingDir, timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER, shell: '/bin/bash' }, (error, stdout, stderr) => {
      let out = stdout || '';
      if (stderr) out += (out ? '\n' : '') + `[stderr]\n${stderr}`;
      if (error && !stdout && !stderr) out = `[error]\n${error.message}`;
      else if (error) out += `\n[exit] ${error.message}`;
      resolve(out.trim() || '(no output)');
    });
  });

  if (projectId && chatId) {
    await db.from('memories').insert({
      project_id: projectId,
      chat_id: chatId,
      content: `[ LOCAL_RESULT / ${workingDir} ]\n${text}`,
      role: 'system',
      metadata: { local_exec: { cwd: workingDir, dangerous: isDangerousLocalCommand(command) } },
      parent_id: null,
      timestamp: new Date().toISOString(),
    });
  }

  return Response.json({ success: true, text });
}
