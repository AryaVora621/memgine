import { describe, it, expect } from 'vitest';
import {
  slugify,
  isMemType,
  parseTagAttrs,
  extractTags,
  parseAskUserContent,
  stripIncompleteTagTail,
} from './tags';

describe('slugify', () => {
  it('kebab-cases and caps at six words', () => {
    expect(slugify('Never hard delete rows in user data tables')).toBe('never-hard-delete-rows-in-user');
  });
  it('strips punctuation', () => {
    expect(slugify('Use JWTs, not sessions!')).toBe('use-jwts-not-sessions');
  });
  it('falls back on empty input', () => {
    expect(slugify('!!!')).toBe('untitled-memory');
  });
});

describe('isMemType', () => {
  it('accepts the four types', () => {
    for (const t of ['user', 'feedback', 'project', 'reference']) expect(isMemType(t)).toBe(true);
  });
  it('rejects anything else', () => {
    expect(isMemType('note')).toBe(false);
    expect(isMemType('')).toBe(false);
  });
});

describe('parseTagAttrs', () => {
  it('parses attributes in any order', () => {
    expect(parseTagAttrs(' type="feedback" room="DATABASE" name="x"')).toEqual({
      type: 'feedback',
      room: 'DATABASE',
      name: 'x',
    });
  });
  it('handles empty values and undefined input', () => {
    expect(parseTagAttrs(' name=""')).toEqual({ name: '' });
    expect(parseTagAttrs(undefined)).toEqual({});
  });
});

describe('extractTags', () => {
  it('extracts a full ADD_FACT with attributes', () => {
    const text = 'before\n<ADD_FACT room="APIS" name="x" type="project" description="d">body</ADD_FACT>\nafter';
    const tags = extractTags(text);
    expect(tags).toHaveLength(1);
    expect(tags[0].tag).toBe('ADD_FACT');
    expect(tags[0].attrs).toEqual({ room: 'APIS', name: 'x', type: 'project', description: 'd' });
    expect(tags[0].content).toBe('body');
  });
  it('leaves unclosed tags as plain text', () => {
    expect(extractTags('<ADD_FACT room="X">never closed')).toHaveLength(0);
  });
  it('ignores unknown tags', () => {
    expect(extractTags('<SOMETHING>hi</SOMETHING>')).toHaveLength(0);
  });
  it('extracts multiple tags and keeps offsets ordered', () => {
    const text = '<ASK_USER>q</ASK_USER> mid <ADD_FACT room="X">f</ADD_FACT>';
    const tags = extractTags(text);
    expect(tags.map(t => t.tag)).toEqual(['ASK_USER', 'ADD_FACT']);
    expect(tags[0].end).toBeLessThan(tags[1].start);
  });
  it('does not let one tag swallow the next (mismatched close)', () => {
    const text = '<ADD_FACT room="X">a</ASK_USER> <ASK_USER>q</ASK_USER>';
    const tags = extractTags(text);
    expect(tags).toHaveLength(1);
    expect(tags[0].tag).toBe('ASK_USER');
  });
});

describe('parseAskUserContent', () => {
  it('splits question from labeled options', () => {
    const { question, options } = parseAskUserContent(
      'Which db?\n<OPTION label="Postgres (Recommended)">Relational, mature</OPTION>\n<OPTION label="Mongo">Document store</OPTION>'
    );
    expect(question).toBe('Which db?');
    expect(options).toEqual([
      { label: 'Postgres (Recommended)', description: 'Relational, mature' },
      { label: 'Mongo', description: 'Document store' },
    ]);
  });
  it('uses first body line as label when label attr missing', () => {
    const { options } = parseAskUserContent('Q?\n<OPTION>Just this</OPTION>');
    expect(options).toEqual([{ label: 'Just this', description: '' }]);
  });
  it('returns no options for a plain question', () => {
    const { question, options } = parseAskUserContent('Plain question?');
    expect(question).toBe('Plain question?');
    expect(options).toHaveLength(0);
  });
});

describe('stripIncompleteTagTail', () => {
  it('passes through text with no tags', () => {
    expect(stripIncompleteTagTail('hello world')).toBe('hello world');
  });
  it('keeps complete tags', () => {
    const text = 'a <ASK_USER>q</ASK_USER> b';
    expect(stripIncompleteTagTail(text)).toBe(text);
  });
  it('hides an unclosed tag mid-stream', () => {
    expect(stripIncompleteTagTail('answer\n<ADD_FACT room="X">partial bod')).toBe('answer\n');
  });
  it('hides a partial opener', () => {
    expect(stripIncompleteTagTail('answer <ADD_FA')).toBe('answer ');
  });
  it('keeps a complete tag while hiding a later incomplete one', () => {
    expect(stripIncompleteTagTail('<ASK_USER>q</ASK_USER> then <PROPOSE_EDIT file="a">x')).toBe(
      '<ASK_USER>q</ASK_USER> then '
    );
  });
});

describe('USE_TOOL tag', () => {
  it('extracts connector/tool attrs and JSON body', () => {
    const text = 'run this:\n<USE_TOOL connector="github" tool="search_issues">{"query":"bug"}</USE_TOOL>';
    const tags = extractTags(text);
    expect(tags).toHaveLength(1);
    expect(tags[0].tag).toBe('USE_TOOL');
    expect(tags[0].attrs.connector).toBe('github');
    expect(tags[0].attrs.tool).toBe('search_issues');
    expect(JSON.parse(tags[0].content)).toEqual({ query: 'bug' });
  });
  it('hides an unclosed USE_TOOL mid-stream', () => {
    expect(stripIncompleteTagTail('ok\n<USE_TOOL connector="a" tool="b">{"x"')).toBe('ok\n');
  });
});
