/**
 * Agent tag parsing: the XML-ish tags models emit (ASK_USER, ADD_FACT,
 * PROPOSE_EDIT, CREATE_AGENT) that render as approval cards in chat.
 * Pure functions, unit-tested in tags.test.ts.
 */

export type MemType = 'user' | 'feedback' | 'project' | 'reference';

export const MEM_TYPES: MemType[] = ['user', 'feedback', 'project', 'reference'];

export const AGENT_TAGS = ['PROPOSE_EDIT', 'ADD_FACT', 'CREATE_AGENT', 'ASK_USER', 'USE_TOOL'] as const;
export type AgentTag = (typeof AGENT_TAGS)[number];

export function isMemType(value: string): value is MemType {
  return (MEM_TYPES as string[]).includes(value);
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .join('-') || 'untitled-memory';
}

export function parseTagAttrs(raw: string | undefined): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (!raw) return attrs;
  const attrRegex = /([a-zA-Z_]+)="([^"]*)"/g;
  let m;
  while ((m = attrRegex.exec(raw)) !== null) attrs[m[1]] = m[2];
  return attrs;
}

export interface ParsedTag {
  tag: AgentTag;
  attrs: Record<string, string>;
  content: string;
  start: number;
  end: number;
}

/**
 * Extract all agent tags from a message. Malformed tags (unclosed, unknown
 * names) are left in place and render as plain text rather than throwing.
 */
export function extractTags(text: string): ParsedTag[] {
  const combined = /<(PROPOSE_EDIT|ADD_FACT|CREATE_AGENT|ASK_USER|USE_TOOL)((?:\s+[a-zA-Z_]+="[^"]*")*)\s*>([\s\S]*?)<\/\1>/g;
  const out: ParsedTag[] = [];
  let m;
  while ((m = combined.exec(text)) !== null) {
    out.push({
      tag: m[1] as AgentTag,
      attrs: parseTagAttrs(m[2]),
      content: m[3].trim(),
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return out;
}

export interface AskUserOption {
  label: string;
  description: string;
}

export function parseAskUserContent(content: string): { question: string; options: AskUserOption[] } {
  const options: AskUserOption[] = [];
  const optionRegex = /<OPTION(?:\s+label="([^"]*)")?\s*>([\s\S]*?)<\/OPTION>/g;
  const question = content
    .replace(optionRegex, (_full, label: string | undefined, body: string) => {
      const text = (body || '').trim();
      options.push({
        label: (label || text.split('\n')[0] || '').trim(),
        description: label ? text : '',
      });
      return '';
    })
    .trim();
  return { question, options };
}

/**
 * While a response streams in, an agent tag may be mid-arrival. Hide the
 * incomplete tail (from the last unclosed opening tag onward) so raw tag
 * source never flashes in the UI; the card appears once the close tag lands.
 */
export function stripIncompleteTagTail(text: string): string {
  const opener = /<(PROPOSE_EDIT|ADD_FACT|CREATE_AGENT|ASK_USER|USE_TOOL)(?:\s|>|$)/g;
  let lastOpen = -1;
  let lastTag = '';
  let m;
  while ((m = opener.exec(text)) !== null) {
    lastOpen = m.index;
    lastTag = m[1];
  }
  // A trailing partial opener like "<ADD_FA" is also incomplete.
  if (lastOpen === -1) return text.replace(/<[A-Z_]{0,12}$/, '');
  if (text.indexOf(`</${lastTag}>`, lastOpen) !== -1) return text.replace(/<[A-Z_]{0,12}$/, '');
  return text.slice(0, lastOpen);
}
