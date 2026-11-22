import { useMemo } from 'react';
import katex from 'katex';
import { marked } from 'marked';

interface MathContentProps {
  text: string;
  className?: string;
}

function renderMarkdownWithKatex(input: string): string {
  if (!input) return '';

  // Replace display math $$...$$ and inline math $...$ with rendered KaTeX HTML placeholders
  const mathBlocks: string[] = [];
  let tokenized = input.replace(/\$\$([\s\S]+?)\$\$/g, (_match, expr) => {
    const idx = mathBlocks.length;
    try {
      mathBlocks.push(katex.renderToString(expr.trim(), { displayMode: true, throwOnError: false }));
    } catch {
      mathBlocks.push(`<code>${expr}</code>`);
    }
    return `@@MATH_BLOCK_${idx}@@`;
  });

  tokenized = tokenized.replace(/\$([^$\n]+?)\$/g, (_match, expr) => {
    const idx = mathBlocks.length;
    try {
      mathBlocks.push(katex.renderToString(expr.trim(), { displayMode: false, throwOnError: false }));
    } catch {
      mathBlocks.push(`<code>${expr}</code>`);
    }
    return `@@MATH_BLOCK_${idx}@@`;
  });

  // Escape basic raw HTML tags before markdown parse for XSS safety
  const escaped = tokenized.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let html = marked.parse(escaped, { async: false, breaks: true }) as string;

  mathBlocks.forEach((rendered, idx) => {
    html = html.replace(`@@MATH_BLOCK_${idx}@@`, rendered);
  });

  return html;
}

export function MathContent({ text, className = '' }: MathContentProps) {
  const html = useMemo(() => renderMarkdownWithKatex(text), [text]);
  return (
    <div
      className={`prose prose-sm max-w-none dark:prose-invert [&>p]:my-1 [&>ol]:list-decimal [&>ol]:pl-5 [&>ul]:list-disc [&>ul]:pl-5 ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
