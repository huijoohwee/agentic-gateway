function normalizeHttpUrl(raw) {
    const url = new URL(String(raw || '').trim());
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
        throw new Error('Use an HTTP or HTTPS page URL without embedded credentials');
    }
    url.hash = '';
    return url.toString();
}
function readClipboardSourceUrl(html) {
    const header = html.match(/(?:^|\r?\n)SourceURL:([^\r\n]+)/i)?.[1]?.trim() || '';
    if (header)
        return header;
    const base = html.match(/<base\b[^>]*\bhref\s*=\s*["']([^"']+)["']/i)?.[1]?.trim() || '';
    return base;
}
function stripClipboardHtmlTransport(raw) {
    const input = String(raw || '');
    const bytes = new TextEncoder().encode(input);
    const number = (key) => {
        const match = input.match(new RegExp(`(?:^|\\r?\\n)${key}:(-?\\d+)`, 'i'));
        return match ? Number(match[1]) : -1;
    };
    const start = number('StartFragment');
    const end = number('EndFragment');
    if (start >= 0 && end > start && end <= bytes.byteLength) {
        return new TextDecoder().decode(bytes.slice(start, end));
    }
    const htmlStart = number('StartHTML');
    const htmlEnd = number('EndHTML');
    if (htmlStart >= 0 && htmlEnd > htmlStart && htmlEnd <= bytes.byteLength) {
        return new TextDecoder().decode(bytes.slice(htmlStart, htmlEnd));
    }
    return input.replace(/^(?:Version|StartHTML|EndHTML|StartFragment|EndFragment|SourceURL):[^\r\n]*\r?\n/gi, '');
}
function escapeHtmlText(value) {
    return String(value || '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[char] || char));
}
function readTitleFromHtml(html) {
    return String(html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1] || '')
        .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
function nonceValue() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}
export async function readCopiedPage(clipboard = globalThis.navigator?.clipboard) {
    if (typeof clipboard?.read !== 'function') {
        throw new Error('Clipboard reading is unavailable. Copy the rendered page, then paste it into the page-content field.');
    }
    let timeout;
    let items;
    try {
        items = await Promise.race([
            clipboard.read(),
            new Promise((_, reject) => {
                timeout = setTimeout(() => reject(new Error('Clipboard access is blocked or taking too long. Copy the rendered page, then paste it into the page-content field.')), 5000);
            }),
        ]);
    }
    finally {
        if (timeout)
            clearTimeout(timeout);
    }
    let clipboardHtml = '';
    let clipboardText = '';
    for (const item of items) {
        if (!clipboardHtml && item.types.includes('text/html'))
            clipboardHtml = await (await item.getType('text/html')).text();
        if (!clipboardText && item.types.includes('text/plain'))
            clipboardText = await (await item.getType('text/plain')).text();
    }
    return { html: clipboardHtml, text: clipboardText };
}
export function createPageCaptureStore({ maxBytes, parameterPrefix = "__local_page_capture_" }) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || typeof parameterPrefix !== "string" || !parameterPrefix)
        throw new TypeError("Invalid page capture options");
    const captures = new Map();
    function prune() {
        const now = Date.now();
        for (const [nonce, capture] of captures) {
            if (capture.expiresAt < now)
                captures.delete(nonce);
        }
        while (captures.size > 16) {
            const oldest = captures.keys().next().value;
            if (!oldest)
                break;
            captures.delete(oldest);
        }
    }
    function stage(rawUrl, clipboardHtml, clipboardText = "") {
        const sourceHint = String(rawUrl || '').trim() || readClipboardSourceUrl(clipboardHtml);
        if (!sourceHint)
            throw new Error('Enter the page URL before capturing its copied content');
        const sourceUrl = normalizeHttpUrl(sourceHint);
        if ([...new URL(sourceUrl).searchParams.keys()].some(key => key.startsWith(parameterPrefix))) {
            throw new Error('This URL uses a reserved local capture parameter. Remove it and capture the page again.');
        }
        let html = stripClipboardHtmlTransport(clipboardHtml);
        if (!html.trim() && clipboardText.trim())
            html = `<article><pre>${escapeHtmlText(clipboardText)}</pre></article>`;
        if (!html.trim())
            throw new Error('Clipboard has no copied webpage content. Copy the rendered page first, then try again.');
        const byteSize = new TextEncoder().encode(html).byteLength;
        if (byteSize > maxBytes) {
            throw new Error(`Copied page exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MiB capture limit`);
        }
        const visibleText = html
            .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
            .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
            .replace(/<[^>]*>/g, ' ')
            .replace(/&(?:nbsp|#160|#x[aA]0);/g, ' ')
            .replace(/&(?:amp|lt|gt|quot|apos);/g, ' ')
            .replace(/\s+/g, ' ').trim();
        if (!visibleText)
            throw new Error('Copied page has no readable text or media');
        const nonce = nonceValue();
        const markerName = parameterPrefix + nonce.slice(0, 12);
        const request = new URL(sourceUrl);
        request.searchParams.set(markerName, nonce);
        prune();
        captures.set(nonce, {
            nonce, markerName, sourceUrl, html, title: readTitleFromHtml(html), expiresAt: Date.now() + 300000,
        });
        prune();
        const title = captures.get(nonce)?.title || '';
        return { requestUrl: request.toString(), sourceUrl, byteSize, title };
    }
    function consume(requestUrl) {
        const url = new URL(String(requestUrl || ''));
        const markerNames = [...url.searchParams.keys()].filter(key => key.startsWith(parameterPrefix));
        if (markerNames.length === 0)
            return null;
        const nonce = markerNames.length === 1 ? url.searchParams.get(markerNames[0]) || '' : '';
        const pending = nonce ? captures.get(nonce) : undefined;
        if (nonce)
            captures.delete(nonce);
        if (markerNames.length !== 1 || !pending || pending.expiresAt < Date.now()) {
            throw new Error('The copied page capture expired. Copy the page and capture it again.');
        }
        const markerName = markerNames[0];
        url.searchParams.delete(markerName);
        url.hash = '';
        if (markerName !== pending.markerName || nonce !== pending.nonce || url.toString() !== pending.sourceUrl) {
            throw new Error('The copied page capture no longer matches this URL. Capture it again before importing.');
        }
        return { sourceUrl: pending.sourceUrl, html: pending.html, title: pending.title };
    }
    return { stage, consume };
}
