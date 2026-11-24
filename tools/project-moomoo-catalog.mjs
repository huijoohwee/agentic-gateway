import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const origin = 'https://open.moomoo.com';
const verbs = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

function docRoutes(path, markdown) {
  const routes = new Set();
  for (const match of markdown.matchAll(/^(GET|POST|PUT|PATCH|DELETE) `(\/[^\s`]+)`/gm)) {
    routes.add(match[1] + ' ' + match[2]);
  }
  // Overview examples can introduce an API without a method/path heading.
  if (path.includes('/overview')) {
    for (const match of markdown.matchAll(/curl -X (GET|POST|PUT|PATCH|DELETE) ['"]https:\/\/webapi\.moomoo\.com(\/[^?'"\s]+)/g)) {
      routes.add(match[1] + ' ' + match[2]);
    }
  }
  if (path === '/api/crypto_trading/account/get-accounts' &&
      markdown.includes('This endpoint reuses the securities trading API.')) {
    routes.add('GET /api/v1.0/accounts/authorized_trd_accs');
  }
  if (path.endsWith('/data-format')) {
    const channel = path.split('/').slice(0, -1).join('/');
    for (const match of markdown.matchAll(/^\| (EVENT_[A-Z_]+|[A-Z_]+|[0-9]+) \|/gm)) {
      routes.add('PUSH ' + channel + '/' + match[1]);
    }
  }
  return [...routes].sort(compare);
}

export async function projectCatalog(mirror, published, observed) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(observed)) throw Error('CATALOG_DATE_REQUIRED');
  const index = await readFile(resolve(mirror, '_import-index.md'));
  const catalog = JSON.parse(published);
  if (catalog.ok !== true || !Array.isArray(catalog.data?.tools) || !catalog.data.tools.length) {
    throw Error('PUBLIC_CATALOG_REQUIRED');
  }
  const ids = new Set();
  const tools = catalog.data.tools.map(({ httpSchema }) => {
    const { apiId, method, path } = JSON.parse(httpSchema);
    if (!/^[a-z][a-z0-9_]{0,127}$/.test(apiId) || ids.has(apiId) || !verbs.has(method) ||
        !/^\/api\/v[\d.]+\/[a-zA-Z0-9_{}/.-]+$/.test(path)) throw Error('INVALID_PUBLIC_SCHEMA');
    ids.add(apiId);
    return { name: apiId, http: method + ' ' + path, http_schema_sha256: digest(httpSchema) };
  }).sort((a, b) => compare(a.name, b.name));
  const sources = new Map();
  for (const line of index.toString().split('\n').filter(line => line.startsWith('| ['))) {
    const row = line.match(/^\| \[.*?\]\(<([^>]+)>\) \| (imported|not imported) \| (.*?) \|/);
    if (!row) throw Error('INVALID_IMPORT_ROW');
    const [, href, status, saved] = row;
    const url = new URL(href);
    if (url.origin !== origin || url.search || url.hash) throw Error('SOURCE_URL_DRIFT');
    const path = url.pathname;
    if (status === 'not imported') {
      if (sources.has(path)) throw Error('DUPLICATE_IMPORT');
      sources.set(path, { path, imported: false });
      continue;
    }
    const file = saved.match(/\]\(<\/websites\/open\.moomoo\.com\/([^>]+)>\)$/)?.[1];
    if (['website.crawl.canvas.md', 'website.sitemap.md'].includes(file)) continue;
    if (!/^api\/[\w/-]+\.md$/.test(file) || sources.has(path)) throw Error('INVALID_IMPORT_FILE');
    const bytes = await readFile(resolve(mirror, file));
    const body = bytes.toString();
    if (!body.includes('kgWebpageUrl: "' + href + '"')) throw Error('SOURCE_URL_DRIFT: ' + path);
    sources.set(path, { path, file, sha256: digest(bytes), routes: docRoutes(path, body) });
  }
  const summary = index.toString().match(/(\d+) known sources · (\d+) imported · (\d+) not fully imported/);
  const missing = [...sources.values()].filter(row => row.imported === false).length;
  if (!summary || sources.size !== Number(summary[1]) || sources.size - missing !== Number(summary[2]) ||
      missing !== Number(summary[3])) throw Error('INCOMPLETE_IMPORT_INDEX');
  return { schema: 'moomoo-documentation-catalog/v1', authority: false, origin,
    index_sha256: digest(index), directory: origin + '/api/biz/mcp/tools',
    directory_observed: observed, directory_sha256: digest(published),
    sources: [...sources.values()].sort((a, b) => compare(a.path, b.path)), tools };
}

// One record per line keeps changes reviewable and the catalog below the file and chunk caps.
export function serializeCatalog({ sources, tools, ...meta }) {
  const rows = list => '[\n' + list.map(row => '    ' + JSON.stringify(row)).join(',\n') + '\n  ]';
  return JSON.stringify(meta, null, 2).slice(0, -2) +
    ',\n  "sources": ' + rows(sources) + ',\n  "tools": ' + rows(tools) + '\n}\n';
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [mirror, capture, date, option] = process.argv.slice(2);
  if (!mirror || !capture || !date || option && option !== '--check') throw Error('Usage: project-moomoo-catalog MIRROR PUBLIC_DIRECTORY_JSON YYYY-MM-DD [--check]');
  const output = new URL('../connectors/moomoo-catalog.json', import.meta.url);
  const body = serializeCatalog(await projectCatalog(mirror, await readFile(capture), date));
  if (Buffer.byteLength(body) >= 500000 || body.split('\n').length >= 600) throw Error('CATALOG_BUDGET');
  if (!option) await writeFile(output, body);
  else if (await readFile(output, 'utf8') !== body) throw Error('CATALOG_DRIFT');
}
