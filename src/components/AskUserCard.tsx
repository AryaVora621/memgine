"use client";

import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { parseAskUserContent } from '@/lib/tags';

export default function AskUserCard({ content, disabled, onAnswer }: {
  content: string;
  disabled: boolean;
  onAnswer: (text: string) => void;
}) {
  const { question, options } = useMemo(() => parseAskUserContent(content), [content]);
  const hasOptions = options.length > 0;
  const [selected, setSelected] = useState<number | 'other' | null>(hasOptions ? null : 'other');
  const [otherText, setOtherText] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [notes, setNotes] = useState('');
  const [submittedAnswer, setSubmittedAnswer] = useState<string | null>(null);

  const answerText = selected === 'other'
    ? otherText.trim()
    : selected !== null
      ? options[selected]?.label ?? ''
      : '';
  const canSubmit = !disabled && !submittedAnswer && answerText.length > 0;
  const amber = 'var(--amber, #d97706)';

  const submit = () => {
    if (!canSubmit) return;
    const trimmedNotes = notes.trim();
    onAnswer(trimmedNotes ? `${answerText}\n\nNotes: ${trimmedNotes}` : answerText);
    setSubmittedAnswer(answerText);
  };

  const optionBtnStyle = (active: boolean): React.CSSProperties => ({
    display: 'block',
    width: '100%',
    textAlign: 'left',
    padding: '8px 10px',
    marginBottom: '6px',
    fontFamily: 'inherit',
    fontSize: 'var(--micro)',
    cursor: submittedAnswer ? 'default' : 'pointer',
    color: active ? amber : 'var(--fg-dim)',
    background: active ? 'rgba(217, 119, 6, 0.12)' : 'var(--bg-raised)',
    border: `1px solid ${active ? amber : 'var(--grid-thick)'}`,
    opacity: submittedAnswer && !active ? 0.45 : 1,
  });

  return (
    <div style={{ border: `1px solid ${amber}`, padding: '12px', margin: '8px 0', background: 'rgba(217, 119, 6, 0.06)' }}>
      <samp style={{ color: amber, display: 'block', marginBottom: '8px' }}>
        [ AGENT QUESTION ]{submittedAnswer ? ' — ANSWERED' : ''}
      </samp>
      <div className="markdown-body" style={{ marginBottom: '10px' }}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{question}</ReactMarkdown>
      </div>

      {options.map((opt, i) => (
        <button
          key={i}
          type="button"
          disabled={!!submittedAnswer}
          style={optionBtnStyle(selected === i)}
          onClick={() => setSelected(i)}
        >
          <span style={{ display: 'block', color: selected === i ? amber : 'var(--fg, inherit)' }}>
            {selected === i ? '● ' : '○ '}{opt.label}
          </span>
          {opt.description && (
            <span style={{ display: 'block', marginTop: '2px', paddingLeft: '16px', color: 'var(--fg-dim)' }}>
              {opt.description}
            </span>
          )}
        </button>
      ))}

      {hasOptions && (
        <button
          type="button"
          disabled={!!submittedAnswer}
          style={optionBtnStyle(selected === 'other')}
          onClick={() => setSelected('other')}
        >
          <span style={{ display: 'block', color: selected === 'other' ? amber : 'var(--fg, inherit)' }}>
            {selected === 'other' ? '● ' : '○ '}Other…
          </span>
        </button>
      )}

      {selected === 'other' && !submittedAnswer && (
        <input
          type="text"
          value={otherText}
          autoFocus={hasOptions}
          placeholder="TYPE YOUR ANSWER…"
          onChange={e => setOtherText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit(); }}
          style={{
            display: 'block', width: '100%', padding: '8px 10px', marginBottom: '6px',
            fontFamily: 'inherit', fontSize: 'var(--micro)', color: 'inherit',
            background: 'var(--bg-raised)', border: '1px solid var(--grid-thick)', outline: 'none',
          }}
        />
      )}

      {!submittedAnswer && (
        <div style={{ marginTop: '4px' }}>
          {!showNotes ? (
            <button
              type="button"
              onClick={() => setShowNotes(true)}
              style={{
                background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                fontFamily: 'inherit', fontSize: 'var(--micro)', color: 'var(--fg-dim)',
                textDecoration: 'underline', textUnderlineOffset: '3px',
              }}
            >
              + ADD NOTES
            </button>
          ) : (
            <textarea
              value={notes}
              autoFocus
              rows={2}
              placeholder="OPTIONAL NOTES FOR THE AGENT…"
              onChange={e => setNotes(e.target.value)}
              style={{
                display: 'block', width: '100%', padding: '8px 10px', marginBottom: '6px',
                fontFamily: 'inherit', fontSize: 'var(--micro)', color: 'inherit', resize: 'vertical',
                background: 'var(--bg-raised)', border: '1px solid var(--grid-thick)', outline: 'none',
              }}
            />
          )}
        </div>
      )}

      {submittedAnswer ? (
        <samp style={{ display: 'block', marginTop: '8px', color: 'var(--green)', fontSize: 'var(--micro)' }}>
          [ SENT: {submittedAnswer} ]
        </samp>
      ) : (
        <button
          className="tab-btn"
          type="button"
          disabled={!canSubmit}
          onClick={submit}
          style={{ background: 'var(--bg-raised)', marginTop: '8px', opacity: canSubmit ? 1 : 0.4 }}
        >
          SUBMIT ANSWER
        </button>
      )}
    </div>
  );
}
