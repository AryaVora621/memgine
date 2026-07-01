/**
 * Local settings manager.
 * Stores API keys and project list in a JSON file at .notebook_config/settings.json
 */
import fs from 'fs';
import path from 'path';

const CONFIG_DIR = path.join(process.cwd(), '.notebook_config');
const SETTINGS_FILE = path.join(CONFIG_DIR, 'settings.json');

export interface ProjectEntry {
  id: string;
  name: string;
  path: string;
  createdAt: string;
}

export interface AppSettings {
  apiKeys: {
    openrouter?: string;
    anthropic?: string;
    openai?: string;
    google?: string;
  };
  projects: ProjectEntry[];
  defaultModel: string;
}

const DEFAULT_SETTINGS: AppSettings = {
  apiKeys: {},
  projects: [],
  defaultModel: 'claude-sonnet-4-20250514',
};

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadSettings(): AppSettings {
  ensureConfigDir();
  if (!fs.existsSync(SETTINGS_FILE)) {
    saveSettings(DEFAULT_SETTINGS);
    return DEFAULT_SETTINGS;
  }
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings) {
  ensureConfigDir();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
}
