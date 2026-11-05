import React, { memo, useMemo, useRef } from 'react';
import { markdownTokens, renderMarkdownToken, highlightLine } from './md.js';

// Source-offset identities survive growth and the final parse. Two trailing
// blocks remain mutable; non-append edits discard the parser cache.
class BlockStream {
  constructor() { this.source = ''; this.frozen = []; this.offset = 0; }
  update(source, streaming) {
    if (!streaming || !source.startsWith(this.source)) { this.frozen = []; this.offset = 0; }
    this.source = source;
    const tail = source.slice(this.offset), tokens = markdownTokens(tail);
    // Raw HTML neutralization can expand source bytes. Freeze only a verbatim
    // prefix, never infer cuts through reference definitions or escaped input.
    const verbatim = tokens.map(token => token.raw).join('') === tail;
    let offset = this.offset;
    const blocks = tokens.map(token => { const block = { key: offset, token }; offset += token.raw.length; return block; });
    const rendered = [...this.frozen, ...blocks];
    if (streaming && verbatim) {
      const visible = blocks.map((block, index) => block.token.type === 'space' ? -1 : index).filter(index => index >= 0);
      const cut = visible.length > 2 ? visible.at(-2) : 0;
      if (cut > 0) { const ready = blocks.slice(0, cut); this.frozen.push(...ready); this.offset += ready.reduce((size, block) => size + block.token.raw.length, 0); }
    }
    return { blocks: rendered, links: tokens.links };
  }
}

const CodeLine = memo(function CodeLine({ text, language }) {
  return <span className="code-line" dangerouslySetInnerHTML={{ __html: highlightLine(text, language) }} />;
});
function CodeBlock({ token }) {
  const language = token.lang?.trim().split(/\s+/)[0] || '';
  const lines = token.text.split('\n');
  return <pre tabIndex={0}><code className={language ? 'language-' + language + ' hljs' : undefined}>{lines.map((line, index) => <React.Fragment key={index}>{index > 0 && '\n'}<CodeLine text={line} language={language} /></React.Fragment>)}</code></pre>;
}
const HtmlBlock = memo(function HtmlBlock({ token, links }) {
  return <div className="markdown-block" dangerouslySetInnerHTML={{ __html: renderMarkdownToken(token, links) }} />;
});
export function MarkdownBlocks({ text, streaming }) {
  const parser = useRef(null); if (!parser.current) parser.current = new BlockStream();
  const value = useMemo(() => parser.current.update(String(text || ''), streaming), [text, streaming]);
  return value.blocks.map(({ key, token }) => token.type === 'space' ? null : token.type === 'code'
    ? <CodeBlock key={key} token={token} /> : <HtmlBlock key={key} token={token} links={value.links} />);
}
