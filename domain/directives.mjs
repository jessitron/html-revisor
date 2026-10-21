// Directives: requests about one element, in the file as <!-- author: text -->. Where one sits
// says which element it is about. Tier II, pure functions over a DOM; the served page and
// scopes.mjs both use the placement rule.
import { VOID, RAW, trimAscii } from './canonical.mjs';
import { ID } from './identity.mjs';

// Directives go before these elements; for everything else a directive is the first child.
// Elements whose content is parsed as plain text (title, iframe, ...) cannot hold a comment.
export const TEXT_ONLY = 'title iframe xmp noembed noframes'.split(' ');
const directiveGoesBefore = (el) => VOID.has(el.localName) || RAW.has(el.localName) || TEXT_ONLY.includes(el.localName);

// A directive is an HTML comment inside an element whose text starts with "<author>:".
// Comments outside any element (before <html>) are never directives.
export function isDirective(node, author) {
  return (
    node.nodeType === 8 &&
    node.parentNode?.nodeType === 1 &&
    node.data.trimStart().startsWith(`${author}:`)
  );
}

export function directiveText(comment, author) {
  return comment.data.trimStart().slice(author.length + 1).trim();
}

// Escape so the text cannot end the comment early. Repeat for runs like "---".
export function escapeDirectiveText(text) {
  let out = text;
  while (out.includes('--')) out = out.replaceAll('--', '- -');
  return out.replaceAll('>', '&gt;');
}

export function allComments(node, found = []) {
  for (const child of node.childNodes) {
    if (child.nodeType === 8) found.push(child);
    else if (child.nodeType === 1) allComments(child, found);
  }
  return found;
}

// The reading rule: a directive belongs to its parent, unless the next element (skipping
// whitespace-only text and comments) is a void or preformatted element; then it belongs to that
// sibling. So a run of turns before an <img> is the img's thread. A parent whose first child is
// such an element keeps its thread as its last child instead (attachComments).
export function directiveOwner(comment) {
  const next = nextContent(comment.nextSibling);
  return next?.nodeType === 1 && directiveGoesBefore(next) ? next : comment.parentNode;
}

// The node, or the first after it that isn't whitespace-only text or a comment.
function nextContent(node) {
  while (node?.nodeType === 8 || (node?.nodeType === 3 && trimAscii(node.data) === '')) node = node.nextSibling;
  return node;
}

// { [element ID]: directive text }; several directives on one element join with newlines.
// A directive on an element with no ID stays in the file, unseen.
export function collectDirectives(document, author) {
  const directives = {};
  for (const comment of allComments(document)) {
    if (!isDirective(comment, author)) continue;
    const id = directiveOwner(comment).getAttribute?.(ID);
    if (id == null) continue;
    const text = directiveText(comment, author);
    directives[id] = id in directives ? `${directives[id]}\n${text}` : text;
  }
  return directives;
}

// A reply is the agent's turn, in the file as <!-- @Human: text -->: the prefix names who the
// words are for. An element's thread is its directives and replies, in file order
// (REPLY-DESIGN.html).
export const REPLY = '@Human';
export const isTurn = (node, author) => isDirective(node, author) || isDirective(node, REPLY);

// [{ prefix, text }], in order: the author's turns and the replies on this element.
export function threadOf(el, author) {
  return allComments(el.ownerDocument)
    .filter((c) => isTurn(c, author) && directiveOwner(c) === el)
    .map((c) => {
      const prefix = isDirective(c, author) ? author : REPLY;
      return { prefix, text: directiveText(c, prefix) };
    });
}

// Takes out every thread: the directives and the replies.
export function removeThreads(document, author) {
  for (const comment of allComments(document)) {
    if (isTurn(comment, author)) comment.remove();
  }
}

// A reply goes after the last turn in the element's thread, or where a directive would go.
export function placeReply(el, text, author) {
  const reply = el.ownerDocument.createComment(` ${REPLY}: ${escapeDirectiveText(text.trim())} `);
  const last = allComments(el.ownerDocument).findLast((c) => isTurn(c, author) && directiveOwner(c) === el);
  if (last) last.after(reply);
  else attachComments(el, [reply]);
}

// Replace the element's directives with this one; empty text leaves it none. Other
// elements' directives stay where they are.
export function setDirective(el, text, author) {
  for (const comment of allComments(el.ownerDocument)) {
    if (isDirective(comment, author) && directiveOwner(comment) === el) comment.remove();
  }
  if (text.trim()) placeDirective(el, text, author);
}

export function placeDirective(el, text, author) {
  attachComments(el, [el.ownerDocument.createComment(` ${author}: ${escapeDirectiveText(text.trim())} `)]);
}

// Put comments on an element, in order, where the reading rule finds them: first children, or
// just before an element that can't hold one. When the first child is such an element, they'd
// read as its, so they go last.
export function attachComments(el, comments) {
  const before = directiveGoesBefore(el) && el.parentNode;
  const first = !before && nextContent(el.firstChild);
  const last = first?.nodeType === 1 && directiveGoesBefore(first);
  const [parent, next] = before ? [el.parentNode, el] : [el, last ? null : el.firstChild];
  for (const comment of comments) parent.insertBefore(comment, next);
}
