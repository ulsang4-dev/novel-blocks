import type { Novel } from '../model/types';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const heading = (depth: number, text: string) => {
  const level = Math.min(depth + 1, 6);
  return `<h${level}>${esc(text)}</h${level}>`;
};
const wrap = (parts: string[]) =>
  `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${parts.join('\n')}</body></html>`;
const plotParagraph = (plot: string) => `<p>${esc(plot).replace(/\n/g, '<br>')}</p>`;

export function manuscriptHtml(novel: Novel): string {
  const parts = [`<h1>${esc(novel.title)}</h1>`];
  const walk = (ids: string[], depth: number) => {
    let previousWasScene = false;
    for (const id of ids) {
      const n = novel.nodes[id];
      if (n.kind === 'block') {
        parts.push(heading(depth, n.title));
        previousWasScene = false;
        walk(n.childIds, depth + 1);
      } else if (n.body && n.body.replace(/<[^>]+>/g, '').trim()) {
        if (previousWasScene) parts.push('<p style="text-align:center">* * *</p>');
        parts.push(n.body);
        previousWasScene = true;
      }
    }
  };
  walk(novel.rootIds, 1);
  return wrap(parts);
}

export function outlineHtml(novel: Novel): string {
  const parts = [`<h1>${esc(novel.title)} — 플롯 개요</h1>`];
  const walk = (ids: string[], depth: number) => {
    for (const id of ids) {
      const n = novel.nodes[id];
      if (n.kind === 'block') {
        parts.push(heading(depth, n.title));
        if (n.plot) parts.push(plotParagraph(n.plot));
        walk(n.childIds, depth + 1);
      } else {
        parts.push(`<p><b>${esc(n.title)}</b></p>`);
        if (n.plot) parts.push(plotParagraph(n.plot));
      }
    }
  };
  walk(novel.rootIds, 1);
  return wrap(parts);
}
