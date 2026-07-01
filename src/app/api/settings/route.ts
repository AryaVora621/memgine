import { NextResponse } from 'next/server';
import { loadSettings, saveSettings } from '@/lib/settings';

// GET — return current settings (with API keys masked)
export async function GET() {
  const settings = loadSettings();
  // Mask API keys for the frontend
  const masked = {
    ...settings,
    apiKeys: {
      openrouter: settings.apiKeys.openrouter ? '••••' + settings.apiKeys.openrouter.slice(-4) : '',
      anthropic: settings.apiKeys.anthropic ? '••••' + settings.apiKeys.anthropic.slice(-4) : '',
      openai: settings.apiKeys.openai ? '••••' + settings.apiKeys.openai.slice(-4) : '',
      google: settings.apiKeys.google ? '••••' + settings.apiKeys.google.slice(-4) : '',
    },
  };
  return NextResponse.json(masked);
}

// POST — update settings
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const current = loadSettings();

    // Only overwrite keys that are actually provided (non-empty, non-masked)
    if (body.apiKeys) {
      for (const key of ['openrouter', 'anthropic', 'openai', 'google'] as const) {
        const val = body.apiKeys[key];
        if (val && !val.startsWith('••••')) {
          current.apiKeys[key] = val;
        }
      }
    }

    if (body.defaultModel) {
      current.defaultModel = body.defaultModel;
    }

    saveSettings(current);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
