import { downloadBlob } from './browser-files.mjs';
export const recordFormats = Object.freeze({
    csv: Object.freeze({ label: 'CSV', extension: '.csv', mime: 'text/csv' }),
    json: Object.freeze({ label: 'JSON', extension: '.json', mime: 'application/json' }),
    markdown: Object.freeze({ label: 'Markdown', extension: '.md', mime: 'text/markdown' })
});
function csvCell(value) {
    let text = String(value ?? '');
    // Spreadsheet applications may execute formulas even inside quoted CSV fields.
    if (typeof value === 'string' && /^\s*[=+@-]/u.test(text) && !/^[+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/iu.test(text))
        text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
}
function markdownCell(value) {
    return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
        .replace(/([\\|`*_~\[\]])/gu, '\\$1').replace(/\r\n?|\n/gu, '<br>');
}
/** Serialize every supplied row in order. Duplicate column labels remain distinct. */
export function serializeRecordView(data, format) {
    const names = data.columns.map(col => col.name);
    const rows = data.rows.map(row => row.cells);
    if (!names.length || rows.some(row => row.length !== names.length))
        throw new TypeError('Invalid export columns.');
    const pivot = data.orientation === 'columns';
    const headers = pivot ? ['Field', ...rows.map((cells, i) => String(cells[0] ?? '').trim() || 'Row ' + (i + 1))] : names;
    const values = pivot ? names.map((name, i) => [name, ...rows.map(cells => cells[i])]) : rows;
    switch (format) {
        case 'json': return JSON.stringify({ columns: headers, rows: values }, null, 2) + '\n';
        case 'csv': return [headers, ...values].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
        case 'markdown': {
            const line = (row) => '| ' + row.map(markdownCell).join(' | ') + ' |';
            return [line(headers), line(headers.map(() => '---')), ...values.map(line)].join('\n') + '\n';
        }
        default: throw new TypeError('Unknown record export format.');
    }
}
export function downloadRecordView(doc, data, format) {
    const text = serializeRecordView(data, format);
    const type = recordFormats[format].mime + ';charset=utf-8';
    const stem = data.name.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^[.\-]+|[.\-]+$/gu, '') || 'Records';
    downloadBlob(new Blob([text], { type }), stem + recordFormats[format].extension, doc);
}
