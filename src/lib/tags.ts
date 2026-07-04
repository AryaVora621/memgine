/**
 * Agent tag parsing: the XML-ish tags models emit (ASK_USER, ADD_FACT,
 * PROPOSE_EDIT, CREATE_AGENT) that render as approval cards in chat.
 * Pure functions, unit-tested in tags.test.ts.
 */

export type MemType = 'user' | 'feedback' | 'project' | 'reference';

export const MEM_TYPES: MemType[] = ['user', 'feedback', 'project', 'reference'];

// Sentinel project row (seeded by migration "global_memory_scope") that holds
// memories visible from every project, alongside each project's own palace.
export const GLOBAL_PROJECT_ID = '00000000-0000-0000-0000-000000000000';

export const AGENT_TAGS = ['PROPOSE_EDIT', 'ADD_FACT', 'CREATE_AGENT', 'ASK_USER', 'USE_TOOL', 'RUN_CODE', 'RUN_LOCAL'] as const;
export type AgentTag = (typeof AGENT_TAGS)[number];

// Approval cards that a global auto-accept toggle may execute without a click.
// ASK_USER is deliberately excluded: it's a question for the operator, not a
// proposed action, so it always requires a manual answer. RUN_LOCAL is
// included here for commands that pass isDangerousLocalCommand() == false;
// dangerous ones always require a manual click regardless of this toggle —
// see isDangerousLocalCommand and its usage in page.tsx.
export const AUTO_ACCEPTABLE_TAGS: AgentTag[] = ['PROPOSE_EDIT', 'ADD_FACT', 'CREATE_AGENT', 'USE_TOOL', 'RUN_CODE', 'RUN_LOCAL'];

// Commands a RUN_LOCAL card must never auto-execute, even with global
// auto-accept on — real filesystem/system-state destruction on the
// operator's actual machine, not a disposable cloud sandbox. This is a
// best-effort denylist, not a sandbox: it catches the common irreversible
// patterns the operator called out (rm -rf and friends), not every possible
// dangerous shell invocation.
const DANGEROUS_COMMAND_PATTERNS: RegExp[] = [
  /\brm\s+(-\w*r\w*f\w*|-\w*f\w*r\w*)\b/i,          // rm -rf / -fr (any flag order)
  /\brm\s+--recursive\b[^\n]*--force\b/i,            // rm --recursive ... --force
  /\brm\s+--force\b[^\n]*--recursive\b/i,
  /\bsudo\b/i,
  /\bsu\s+-/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\bdiskutil\s+(erase|reformat|partitiondisk)/i,
  /\bchmod\s+-R\b/i,
  /\bchown\s+-R\b/i,
  />\s*\/dev\/(disk|r?sd)/i,
  /\b(shutdown|reboot|halt|poweroff)\b/i,
  /\bkill\s+-9\s+1\b/i,
  /\bpkill\s+-9\b/i,
  /\bgit\s+push\b[^\n]*(--force|-f)\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-\w*f/i,
  /\bcurl\b[^\n|]*\|\s*(sh|bash|zsh)\b/i,             // pipe remote script to a shell
  /\bwget\b[^\n|]*\|\s*(sh|bash|zsh)\b/i,
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,          // fork bomb
];

export function isDangerousLocalCommand(command: string): boolean {
  return DANGEROUS_COMMAND_PATTERNS.some(re => re.test(command));
}

// A voluntary end-of-loop marker, not an approval card: after a tool/sandbox
// result auto-continues the conversation (see page.tsx autoContinue), the
// model emits <STOP/> to say "nothing more to do without new operator input"
// instead of drifting until the auto-continue cap kicks in.
const STOP_TAG_RE = /<STOP\s*\/?>(?:\s*<\/STOP>)?/i;

export function hasStopTag(text: string): boolean {
  return STOP_TAG_RE.test(text);
}

export function stripStopTag(text: string): string {
  return text.replace(STOP_TAG_RE, '').trimEnd();
}

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
  const combined = /<(PROPOSE_EDIT|ADD_FACT|CREATE_AGENT|ASK_USER|USE_TOOL|RUN_CODE|RUN_LOCAL)((?:\s+[a-zA-Z_]+="[^"]*")*)\s*>([\s\S]*?)<\/\1>/g;
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
  const opener = /<(PROPOSE_EDIT|ADD_FACT|CREATE_AGENT|ASK_USER|USE_TOOL|RUN_CODE|RUN_LOCAL)(?:\s|>|$)/g;
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
