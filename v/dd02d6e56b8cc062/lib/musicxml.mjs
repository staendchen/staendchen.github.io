const MAX_INPUT = 4 * 1024 * 1024;
const MAX_DEPTH = 128;
const MAX_NODES = 500000;
const MAX_ATTRIBUTES = 64;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/;
const BAD_AMPERSAND = /&(?!(?:#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|amp|lt|gt|quot|apos);)/;
const NAME = /^[A-Za-z_][\w.:-]*$/;
const ATTRIBUTE = /\s+([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/y;
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export class MusicXmlError extends Error {}

function decode(raw) {
  return raw.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-z]{2,4});/g, (match, body) => {
    if (Object.hasOwn(ENTITIES, body)) return ENTITIES[body];
    if (body[0] !== '#') return match;
    const code = body[1] === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return match;
    return String.fromCodePoint(code);
  });
}

function encode(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

function parseAttributes(source, at) {
  const attributes = [];
  const seen = new Set();
  let index = 0;
  while (index < source.length) {
    ATTRIBUTE.lastIndex = index;
    const match = ATTRIBUTE.exec(source);
    if (!match) {
      if (/^\s*$/.test(source.slice(index))) break;
      throw new MusicXmlError(`invalid attribute at ${at}`);
    }
    const name = match[1];
    if (seen.has(name)) throw new MusicXmlError(`duplicate attribute at ${at}`);
    if (seen.size >= MAX_ATTRIBUTES) throw new MusicXmlError(`too many attributes at ${at}`);
    if (BAD_AMPERSAND.test(match[2] ?? match[3])) throw new MusicXmlError(`invalid entity at ${at}`);
    seen.add(name);
    attributes.push({ name, raw: match[2] ?? match[3], quote: match[2] === undefined ? "'" : '"' });
    index = ATTRIBUTE.lastIndex;
  }
  return attributes;
}

function tagEnd(source, start, doctype = false) {
  let quote = '';
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '>') {
      return i;
    } else if (doctype && c === '[') {
      throw new MusicXmlError('internal DTD subsets are not allowed');
    } else if (c === '<') {
      break;
    }
  }
  throw new MusicXmlError(`unterminated tag at ${start}`);
}

function closing(source, start, marker) {
  const end = source.indexOf(marker, start);
  if (end === -1) throw new MusicXmlError(`unterminated markup at ${start}`);
  return end + marker.length;
}

export function element(name, children = [], attributes = []) {
  return { type: 'element', name, attributes, children };
}

export function textNode(text) {
  return { type: 'text', raw: encode(text) };
}

export function parse(source) {
  if (typeof source !== 'string') throw new MusicXmlError('input must be a string');
  if (source.length > MAX_INPUT) throw new MusicXmlError('input too large');
  if (CONTROL.test(source)) throw new MusicXmlError('control characters are not allowed');
  const document = { type: 'document', children: [] };
  const stack = [document];
  let nodes = 0;
  let rootSeen = false;
  let doctypeSeen = false;
  let index = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  const add = (node) => {
    if (++nodes > MAX_NODES) throw new MusicXmlError('too many nodes');
    stack[stack.length - 1].children.push(node);
  };
  while (index < source.length) {
    const open = source.indexOf('<', index);
    const stop = open === -1 ? source.length : open;
    if (stop > index) {
      const raw = source.slice(index, stop);
      if (stack.length === 1 && /\S/.test(raw)) throw new MusicXmlError(`text outside the root element at ${index}`);
      if (BAD_AMPERSAND.test(raw)) throw new MusicXmlError(`invalid entity at ${index}`);
      add({ type: 'text', raw });
    }
    if (open === -1) break;
    if (source.startsWith('<!--', open)) {
      index = closing(source, open + 4, '-->');
      add({ type: 'raw', raw: source.slice(open, index) });
    } else if (source.startsWith('<?', open)) {
      index = closing(source, open + 2, '?>');
      add({ type: 'raw', raw: source.slice(open, index) });
    } else if (source.startsWith('<!', open)) {
      if (stack.length !== 1 || rootSeen || doctypeSeen || !source.startsWith('<!DOCTYPE', open)) throw new MusicXmlError(`unexpected declaration at ${open}`);
      index = tagEnd(source, open + 2, true) + 1;
      doctypeSeen = true;
      add({ type: 'raw', raw: source.slice(open, index) });
    } else if (source.startsWith('</', open)) {
      const end = source.indexOf('>', open);
      if (end === -1) throw new MusicXmlError(`unterminated closing tag at ${open}`);
      const name = source.slice(open + 2, end).trim();
      const top = stack[stack.length - 1];
      if (stack.length === 1 || top.name !== name) throw new MusicXmlError(`unexpected closing tag ${name.slice(0, 40)} at ${open}`);
      stack.pop();
      index = end + 1;
    } else {
      const end = tagEnd(source, open + 1);
      let body = source.slice(open + 1, end);
      const selfClosing = body.endsWith('/');
      if (selfClosing) body = body.slice(0, -1);
      const name = /^[^\s]*/.exec(body)[0];
      if (!NAME.test(name)) throw new MusicXmlError(`invalid element name at ${open}`);
      if (stack.length === 1) {
        if (rootSeen) throw new MusicXmlError('more than one root element');
        rootSeen = true;
      }
      const node = element(name, [], parseAttributes(body.slice(name.length), open));
      add(node);
      if (!selfClosing) {
        if (stack.length > MAX_DEPTH) throw new MusicXmlError('nesting too deep');
        stack.push(node);
      }
      index = end + 1;
    }
  }
  if (stack.length !== 1) throw new MusicXmlError(`unclosed element ${stack[stack.length - 1].name}`);
  if (!document.children.some((n) => n.type === 'element')) throw new MusicXmlError('no root element');
  return document;
}

export function serialize(node) {
  if (node.type === 'text' || node.type === 'raw') return node.raw;
  if (node.type === 'document') return node.children.map(serialize).join('');
  const attributes = node.attributes.map((a) => ` ${a.name}=${a.quote}${a.raw}${a.quote}`).join('');
  if (!node.children.length) return `<${node.name}${attributes}/>`;
  return `<${node.name}${attributes}>${node.children.map(serialize).join('')}</${node.name}>`;
}

export function root(document) {
  return document.children.find((n) => n.type === 'element');
}

export function children(node, name) {
  return node.children.filter((n) => n.type === 'element' && (name === undefined || n.name === name));
}

export function child(node, name) {
  return node.children.find((n) => n.type === 'element' && n.name === name);
}

export function descendants(node, name) {
  const found = [];
  const stack = [...node.children].reverse();
  while (stack.length) {
    const current = stack.pop();
    if (current.type !== 'element') continue;
    if (current.name === name) found.push(current);
    for (let i = current.children.length - 1; i >= 0; i--) stack.push(current.children[i]);
  }
  return found;
}

export function text(node) {
  if (!node) return undefined;
  return decode(node.children.filter((n) => n.type === 'text').map((n) => n.raw).join(''));
}

export function setText(node, value) {
  node.children = [textNode(value)];
}

export function attribute(node, name) {
  const found = node.attributes.find((a) => a.name === name);
  return found ? decode(found.raw) : undefined;
}

export function setAttribute(node, name, value) {
  const found = node.attributes.find((a) => a.name === name);
  if (found) Object.assign(found, { raw: encode(value), quote: '"' });
  else node.attributes.push({ name, raw: encode(value), quote: '"' });
}

export function keepChildren(parent, keep) {
  parent.children = parent.children.filter((node) => node.type !== 'element' || keep(node));
}

export function remove(parent, node) {
  const index = parent.children.indexOf(node);
  if (index !== -1) parent.children.splice(index, 1);
}

export function insertAfter(parent, node, after) {
  const index = after ? parent.children.indexOf(after) : -1;
  parent.children.splice(index + 1, 0, node);
}
