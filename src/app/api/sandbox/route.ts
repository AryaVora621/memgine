import { authedClient } from '@/lib/serverSupabase';
import { Sandbox } from '@vercel/sandbox';

// RUN_CODE execution: a persistent-per-chat Vercel Sandbox (Firecracker
// microVM) so the agent can run real python/node/bash, including curl against
// external APIs. Persistence is by deterministic name (`memgine-chat-<id>`),
// not a stored id, so a stale/missing DB row never strands the sandbox.
// Two forced safeguards the agent cannot override: idle timeout (stop+recreate
// after 30min of inactivity) and max lifetime (Sandbox `timeout` at creation).

const IDLE_MS = 30 * 60 * 1000;
const MAX_LIFETIME_MS = 2 * 60 * 60 * 1000;

const RUNTIME_MAP: Record<string, string> = {
  python: 'python3.13',
  node: 'node24',
  bash: 'node24',
};

function sandboxCredentials() {
  if (process.env.VERCEL_TOKEN && process.env.VERCEL_TEAM_ID && process.env.VERCEL_PROJECT_ID) {
    return {
      token: process.env.VERCEL_TOKEN,
      teamId: process.env.VERCEL_TEAM_ID,
      projectId: process.env.VERCEL_PROJECT_ID,
    };
  }
  return {};
}

export async function POST(req: Request) {
  try {
    const auth = await authedClient(req);
    if (auth === 'unauthorized' || auth === null) {
      return Response.json({ success: false, error: 'UNAUTHORIZED' }, { status: 401 });
    }
    const { db } = auth;

    const { projectId, chatId, runtime = 'python', code, reset } = await req.json();
    if (!chatId || !code) {
      return Response.json({ success: false, error: 'chatId and code are required' }, { status: 400 });
    }

    const name = `memgine-chat-${chatId}`;
    const { data: chat } = await db.from('chats').select('sandbox_last_used_at').eq('id', chatId).single();
    const idleExpired = chat?.sandbox_last_used_at
      ? Date.now() - new Date(chat.sandbox_last_used_at).getTime() > IDLE_MS
      : false;

    let sandbox: Sandbox | null = null;
    if (!reset && !idleExpired) {
      try {
        sandbox = await Sandbox.get({ ...sandboxCredentials(), name });
      } catch {
        sandbox = null;
      }
    }
    if (!sandbox) {
      if (idleExpired || reset) {
        try {
          const stale = await Sandbox.get({ ...sandboxCredentials(), name, resume: false });
          await stale.stop();
        } catch {}
      }
      sandbox = await Sandbox.create({
        ...sandboxCredentials(),
        name,
        runtime: RUNTIME_MAP[runtime] || 'python3.13',
        timeout: MAX_LIFETIME_MS,
      });
    }

    await db.from('chats').update({
      sandbox_id: name,
      sandbox_last_used_at: new Date().toISOString(),
    }).eq('id', chatId);

    const cmd: [string, string[]] = runtime === 'python' ? ['python3', ['-c', code]]
      : runtime === 'node' ? ['node', ['-e', code]]
      : ['sh', ['-c', code]];

    const result = await sandbox.runCommand(cmd[0], cmd[1]);
    const stdout = (await result.stdout()) || '';
    const stderr = (await result.stderr()) || '';
    let text = stdout;
    if (stderr) text += (text ? '\n' : '') + `[stderr]\n${stderr}`;
    if (!text.trim()) text = '(no output)';

    if (projectId && chatId) {
      await db.from('memories').insert({
        project_id: projectId,
        chat_id: chatId,
        content: `[ SANDBOX_RESULT / ${runtime} ]\n${text}`,
        role: 'system',
        metadata: { sandbox: { runtime, reset: !!reset } },
        parent_id: null,
        timestamp: new Date().toISOString(),
      });
    }

    return Response.json({ success: true, text });
  } catch (error) {
    return Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}
