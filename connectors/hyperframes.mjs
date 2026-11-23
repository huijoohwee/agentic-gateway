// A resource-free profile for HyperFrames declarative HTML. Parse in an inert
// template and emit only inspected DOM. The original composition stays editable.
const tags = new Set(['div', 'section', 'article', 'header', 'footer', 'main', 'h1', 'h2', 'h3', 'p', 'span', 'strong', 'em', 'br']);
const attrs = new Set(['id', 'class', 'style', 'data-composition-id', 'data-no-timeline', 'data-width',
  'data-height', 'data-start', 'data-duration', 'data-track-index']);
const properties = new Set(['position','inset','top','left','right','bottom','width','height','display','overflow',
  'z-index','background-color','color','font-size','font-weight','text-align','line-height','margin','padding',
  'align-items','justify-content','box-sizing','opacity']);
const identifier = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
function reject(reason) { throw new TypeError('HyperFrames: ' + reason); }

function numberAttr(el, name, max, positive = false) {
  const text = el.getAttribute(name);
  if (text === null || !/^\d+(?:\.\d+)?$/.test(text)) reject('expected numeric ' + name);
  const number = Number(text);
  if (number > max || (positive && number <= 0)) reject('out of range ' + name);
  return number;
}

function validateStyle(el) {
  for (const declaration of (el.getAttribute('style') || '').split(';')) {
    if (!declaration.trim()) continue;
    const match = /^\s*([a-z-]+)\s*:\s*([a-z0-9#.% +\-]+)\s*$/i.exec(declaration);
    if (!match || !properties.has(match[1]) || !el.style.getPropertyValue(match[1])) reject('unsupported inline style');
  }
}

// 'document' is supplied by the browser host. The returned spec uses integer
// milliseconds and retains clip IDs, DOM order, text and inline styling.
export function importHyperframesHtml(source, document) {
  if (typeof source !== 'string' || source.length > 128000 || new TextEncoder().encode(source).length > 128000) reject('composition too large');
  // Template parsing discards document wrapper attributes.
  for (const match of source.matchAll(/<(html|head|body)\b([^>]*)>/gi)) {
    const attributes = match[2].trim();
    if (attributes && !(match[1].toLowerCase() === 'html' && /^lang=(?:"[a-z-]+"|'[a-z-]+')$/i.test(attributes))) {
      reject('unsupported document attributes');
    }
  }
  const template = document.createElement('template');
  template.innerHTML = source;
  const content = template.content;
  const roots = content.querySelectorAll('[data-composition-id]');
  if (roots.length !== 1) reject('expected a single composition');
  const root = roots[0];
  if (!root.hasAttribute('data-no-timeline') || !identifier.test(root.getAttribute('data-composition-id'))) reject('expected a declarative timeline');
  if (numberAttr(root,'data-start',0) !== 0) reject('invalid root start');
  const durationMs = numberAttr(root,'data-duration',3600,true) * 1000;
  const width = numberAttr(root,'data-width',7680,true), height = numberAttr(root,'data-height',4320,true);
  if (![durationMs,width,height].every(Number.isSafeInteger)) reject('fractional dimensions or sub-millisecond duration');
  const ids = new Set(), clips = [];
  for (const node of content.children) {
    if (node === root || node.localName === 'title' ||
        (node.localName === 'meta' && node.attributes.length === 1 && node.hasAttribute('charset'))) continue;
    reject('unsupported document element ' + node.localName);
  }
  for (const node of content.childNodes) if (node.nodeType === 3 && node.textContent.trim()) reject('text outside composition');
  for (const el of [root, ...root.querySelectorAll('*')]) {
    if (!tags.has(el.localName) || el.namespaceURI !== 'http://www.w3.org/1999/xhtml') reject('unsupported element ' + el.localName);
    for (const attr of el.attributes) if (!attrs.has(attr.name)) reject('unsupported attribute ' + attr.name);
    validateStyle(el);
    if (el.id) {
      if (!identifier.test(el.id) || ids.has(el.id)) reject('invalid or duplicate element id');
      ids.add(el.id);
    }
    if (el === root) continue;
    if (['data-width','data-height','data-no-timeline'].some(name => el.hasAttribute(name))) reject('nested composition metadata');
    if (['data-start','data-duration','data-track-index'].some(name => el.hasAttribute(name))) {
      if (!el.id || el.parentElement !== root) reject('expected an identified top-level clip');
      const start = numberAttr(el,'data-start',durationMs / 1000) * 1000;
      const end = start + numberAttr(el,'data-duration',durationMs / 1000,true) * 1000;
      if (![start,end].every(Number.isSafeInteger) || end > durationMs) reject('invalid clip interval');
      if (el.hasAttribute('data-track-index') && !Number.isSafeInteger(numberAttr(el,'data-track-index',65535))) reject('invalid track');
      clips.push({ id: el.id, start, end });
    }
  }
  return { html: root.outerHTML, durationMs, width, height, clips, compositionId: root.getAttribute('data-composition-id') };
}
