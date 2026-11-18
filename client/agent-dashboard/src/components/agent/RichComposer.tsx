import React, { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { markdownToEditorHtml, nodeToMarkdown, pastedText } from '../../lib/richText';

/**
 * The reply box: a rich-text editor that shows **bold** and *italic* as real formatting
 * (pasted from Sheets/Docs, or Cmd+B / Cmd+I) while its value stays plain markdown,
 * which is what gets sent and stored.
 */
export interface RichComposerHandle { focus: () => void }

interface Props {
  value: string;
  onChange: (markdown: string) => void;
  /** Files pasted in (e.g. screenshots); return true if handled. */
  onPasteFiles?: (files: File[]) => void;
  placeholder?: string;
  className?: string;
}

const toMarkdown = (el: HTMLElement) =>
  nodeToMarkdown(el, true).text.replace(/\n+$/, ''); // drop the trailing break the browser keeps

function placeCaretAtEnd(el: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

const RichComposer = forwardRef<RichComposerHandle, Props>(({ value, onChange, onPasteFiles, placeholder, className }, ref) => {
  const elRef = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef<string | null>(null);

  useImperativeHandle(ref, () => ({
    focus: () => { const el = elRef.current; if (el) { el.focus(); placeCaretAtEnd(el); } },
  }));

  // Value changed from outside (sent → cleared, saved reply, emoji, draft restore): redraw
  useLayoutEffect(() => {
    const el = elRef.current;
    if (!el || value === lastEmitted.current) return;
    el.innerHTML = value ? markdownToEditorHtml(value) : '';
    lastEmitted.current = value;
    if (document.activeElement === el) placeCaretAtEnd(el);
  }, [value]);

  const emit = () => {
    const el = elRef.current;
    if (!el) return;
    let md = toMarkdown(el);
    if (!md.trim() && !el.querySelector('img')) { md = ''; if (el.innerHTML) el.innerHTML = ''; } // keep :empty for the placeholder
    lastEmitted.current = md;
    onChange(md);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const files = Array.from(e.clipboardData.files || []).filter(f => f.type.startsWith('image/'));
    if (files.length && onPasteFiles) { e.preventDefault(); onPasteFiles(files); return; }
    e.preventDefault(); // never let foreign HTML/styles into the box
    const text = pastedText(e.clipboardData) ?? e.clipboardData.getData('text/plain');
    if (!text) return;
    document.execCommand('insertHTML', false, markdownToEditorHtml(text));
    emit();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'u') e.preventDefault(); // underline can't be sent
    if (mod && (e.key.toLowerCase() === 'b' || e.key.toLowerCase() === 'i')) {
      e.preventDefault();
      document.execCommand(e.key.toLowerCase() === 'b' ? 'bold' : 'italic');
      emit();
    }
  };

  return (
    <div
      ref={elRef}
      role="textbox"
      aria-multiline="true"
      aria-label={placeholder}
      contentEditable
      suppressContentEditableWarning
      data-placeholder={placeholder}
      onInput={emit}
      onPaste={handlePaste}
      onKeyDown={handleKeyDown}
      onDrop={(e) => e.preventDefault()}
      className={`rich-composer whitespace-pre-wrap break-words overflow-y-auto ${className || ''}`}
    />
  );
});

RichComposer.displayName = 'RichComposer';
export default RichComposer;
