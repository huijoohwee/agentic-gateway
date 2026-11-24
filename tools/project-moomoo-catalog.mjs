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

function publicDescriptors(published) {
  const catalog = JSON.parse(published);
  if (catalog.ok !== true || !Array.isArray(catalog.data?.tools) || !catalog.data.tools.length) {
    throw Error('PUBLIC_CATALOG_REQUIRED');
  }
  const ids = new Set();
  return catalog.data.tools.map(({ httpSchema }) => {
    const descriptor = JSON.parse(httpSchema);
    const { apiId, method, path } = descriptor;
    if (!/^[a-z][a-z0-9_]{0,127}$/.test(apiId) || ids.has(apiId) || !verbs.has(method) ||
        !/^\/api\/v[\d.]+\/[a-zA-Z0-9_{}/.-]+$/.test(path)) throw Error('INVALID_PUBLIC_SCHEMA');
    ids.add(apiId);
    return { descriptor, row: { name: apiId, http: method + ' ' + path, http_schema_sha256: digest(httpSchema) } };
  }).sort((a, b) => compare(a.row.name, b.row.name));
}

export async function projectCatalog(mirror, published, observed) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(observed)) throw Error('CATALOG_DATE_REQUIRED');
  const index = await readFile(resolve(mirror, '_import-index.md'));
  const tools = publicDescriptors(published).map(value => value.row);
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

const fieldName = /^[A-Za-z_][A-Za-z0-9_]*$/;
const constraints = ['default', 'enum', 'min', 'max', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'pattern'];
function inputFields(fields, depth = 0) {
  if (!Array.isArray(fields) || depth > 8) throw Error('INVALID_PUBLIC_FIELDS');
  const names = new Set();
  return fields.map(field => {
    if (!field || !fieldName.test(field.name) || typeof field.name !== 'string' || names.has(field.name) ||
        typeof field.type !== 'string' || !field.type || Object.hasOwn(field, 'required') && typeof field.required !== 'boolean') {
      throw Error('INVALID_PUBLIC_FIELDS');
    }
    names.add(field.name);
    const projected = { name: field.name, type: field.type };
    for (const key of ['required', ...constraints]) if (Object.hasOwn(field, key)) projected[key] = field[key];
    const nested = field.subFields ?? field.sub_fields;
    if (nested !== undefined) projected.fields = inputFields(nested, depth + 1);
    return projected;
  });
}

// This is the provider's public HTTP documentation. Each host must discover
// its own MCP inputSchema independently when it admits a connected operation.
export function projectFields(catalog, published) {
  if (catalog?.schema !== 'moomoo-documentation-catalog/v1' || catalog.authority !== false ||
      catalog.directory_sha256 !== digest(published)) throw Error('PUBLIC_DIRECTORY_DRIFT');
  const descriptors = publicDescriptors(published);
  if (descriptors.length !== catalog.tools.length) throw Error('PUBLIC_TOOL_DRIFT');
  const tools = descriptors.map(({ descriptor, row }, index) => {
    const pin = catalog.tools[index];
    if (pin.name !== row.name || pin.http !== row.http || pin.http_schema_sha256 !== row.http_schema_sha256) throw Error('PUBLIC_TOOL_DRIFT');
    const { request, response } = descriptor;
    if (!response?.fields || typeof response.fields !== 'object' || Array.isArray(response.fields) ||
        !Object.keys(response.fields).every(name => fieldName.test(name))) throw Error('INVALID_PUBLIC_FIELDS');
    const path = [...descriptor.path.matchAll(/\{(\w+)\}/g)].map(match => match[1]);
    return { name: row.name, path, params: inputFields(request?.params), body: inputFields(request?.body),
      response: Object.keys(response.fields).sort(compare), ...(response.wrap && { wrap: response.wrap }),
      ...(response.pagination && { pagination: Object.keys(response.pagination).sort(compare) }) };
  });
  return { schema: 'moomoo-public-http-fields/v1', authority: false, directory_sha256: catalog.directory_sha256, tools };
}

async function fieldsCommand(args) {
  const [capture, check] = args;
  if (!capture || args.length > 2 || check !== undefined && check !== '--check') throw Error('Usage: --fields DIRECTORY.json [--check]');
  const catalog = JSON.parse(await readFile(new URL('../connectors/moomoo-catalog.json', import.meta.url), 'utf8'));
  const { tools, ...header } = projectFields(catalog, await readFile(capture));
  const text = JSON.stringify(header, null, 2).slice(0, -2) + ',\n  "tools": [\n' +
    tools.map(row => '    ' + JSON.stringify(row)).join(',\n') + '\n  ]\n}\n';
  if (Buffer.byteLength(text) >= 100_000) throw Error('FIELDS_BUDGET');
  const out = new URL('../connectors/moomoo-fields.json', import.meta.url);
  if (check) { if (await readFile(out, 'utf8') !== text) throw Error('PUBLIC_FIELDS_DRIFT'); }
  else await writeFile(out, text);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2] === '--fields') await fieldsCommand(process.argv.slice(3));
  else await catalogCommand(process.argv.slice(2));
}

async function catalogCommand(args) {
  const [mirror, capture, date, option] = args;
  if (!mirror || !capture || !date || option && option !== '--check') throw Error('Usage: project-moomoo-catalog MIRROR PUBLIC_DIRECTORY_JSON YYYY-MM-DD [--check]');
  const output = new URL('../connectors/moomoo-catalog.json', import.meta.url);
  const body = serializeCatalog(await projectCatalog(mirror, await readFile(capture), date));
  if (Buffer.byteLength(body) >= 500000 || body.split('\n').length >= 600) throw Error('CATALOG_BUDGET');
  if (!option) await writeFile(output, body);
  else if (await readFile(output, 'utf8') !== body) throw Error('CATALOG_DRIFT');
}
