// Markdown edits: the markdown the box shows for each scope, and what saving it does to the
// document. Tier II, pure functions over a DOM.
import { parse, trimAscii } from './canonical.mjs';
import { ID, assignIds, reconcile } from './identity.mjs';
import { removeThreads, carryDirectives } from './directives.mjs';
import { scopeElements, scopeMarkdown, nodesFromMarkdown, editable } from './scopes.mjs';
import { normalize } from './format.mjs';

// Each scope's markdown, by ID: what the box shows. Not body's, which nobody picks, and not a
// scope too big to edit.
export function markdownsOf(scopes) {
  return Object.fromEntries(
    scopes.filter((el) => el.hasAttribute(ID) && el.localName !== 'body' && editable(el)).map((el) => [el.getAttribute(ID), scopeMarkdown(el)]),
  );
}

// Each scope's markdown in the committed copy of the page, by ID: what Revert puts back. A
// commit made mid-loop holds IDs; one committed clean gets them from normalize, which numbers a
// page the same way every time, so they match the page as first opened if it hasn't changed
// since. No commit, or a copy the formatter can't handle, gives none.
export function committedMarkdowns(html, author) {
  if (html === null) return {};
  try {
    const document = parse(normalize(html));
    removeThreads(document, author);
    return markdownsOf(scopeElements(document));
  } catch {
    return {};
  }
}

// The nodes that replace a scope's element when its markdown is saved: what the markdown says
// (scopes.mjs), with the IDs (identity.mjs) and directives (directives.mjs) of the elements you
// left or changed. Saving it unchanged gives back the same HTML, element IDs and directives
// included (SCOPES-DESIGN.html#identity).
export function scopeFromMarkdown(el, markdown) {
  const nodes = nodesFromMarkdown(el, markdown);
  return carryDirectives(el, nodes, reconcile([el], nodes));
}

// Replace a scope with what its markdown says. The elements you left or changed keep their IDs
// and directives (scopeFromMarkdown); new ones get IDs. Returns the nodes that replaced it,
// or null, changing nothing, for an element that isn't a scope, one too big to edit, or blank markdown.
export function saveMarkdown(el, markdown) {
  const document = el.ownerDocument;
  if (trimAscii(markdown) === '' || el.localName === 'body' || !editable(el) || !scopeElements(document).includes(el)) return null;
  const nodes = scopeFromMarkdown(el, markdown);
  el.replaceWith(...nodes);
  assignIds(document);
  return nodes;
}

// The nodes as the tab shows them: threads lifted out.
export function servedHTML(nodes, author) {
  const holder = nodes[0].ownerDocument.createElement('div');
  holder.append(...nodes.map((n) => n.cloneNode(true)));
  removeThreads(holder, author);
  return holder.innerHTML;
}

// The ID that holds the scope after a save: its own, if its element came back, else the first
// new scope's, so the box can follow it. Null when the scope became bare text.
export function holderOf(nodes, id, scopes) {
  const els = nodes.filter((n) => n.nodeType === 1);
  const holder = els.find((e) => e.getAttribute(ID) === id) ?? els.find((e) => scopes.has(e) && e.hasAttribute(ID));
  return holder?.getAttribute(ID) ?? null;
}
