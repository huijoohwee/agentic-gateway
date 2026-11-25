import { createRecordRelation } from '../vendor/agentic-base/record-links.mjs';

// Project documentation from the caller's pinned catalog without opening a transport.
function checkCatalog(catalog) {
  if (catalog?.schema !== 'moomoo-documentation-catalog/v1' || catalog.authority !== false) {
    throw Error('COVERAGE_SOURCE_DRIFT');
  }
}

export function publicRoutes(catalog) {
  checkCatalog(catalog);
  const routes = new Map();
  function add(transport, label, source) {
    // The directory and the reference pages can use different path variable names.
    const identity = transport === 'REST' ? label.replace(/\{[A-Za-z_][\w]*\}/g, '{}') : label;
    const key = transport + ' ' + identity;
    if (!routes.has(key)) routes.set(key, { transport, label, sources: [] });
    routes.get(key).sources.push(source);
  }
  for (const doc of catalog.sources) {
    const record = doc.reference ?? doc;
    const url = doc.reference ? catalog.origin + '/' + record.file : catalog.origin + doc.path;
    for (const route of record.routes ?? []) {
      const source = { url, digest: record.sha256 };
      if (route.startsWith('PUSH ')) add('Push', route.slice(5), source);
      else add('REST', route, { ...source, http: route });
    }
  }
  for (const tool of catalog.tools) {
    const source = { url: catalog.directory, digest: tool.http_schema_sha256, tool: tool.name, http: tool.http };
    add('MCP', tool.name, source);
    add('REST', tool.http, source);
  }
  return [...routes.values()];
}

export function namingDictionaries(catalog) {
  checkCatalog(catalog);
  return catalog.sources.flatMap(doc => {
    const match = /^\/api\/([^/]+)\/naming-dictionary$/.exec(doc.path);
    return match ? [{ area: match[1], path: doc.path, url: new URL(doc.path, catalog.origin).href,
      digest: (doc.reference ?? doc).sha256 }] : [];
  });
}

// The catalog retains each source spelling, including aliases folded into one REST route.
export const routeId = row => row.transport + ' ' + row.label;

export function coverageRelations(catalog, routes = publicRoutes(catalog)) {
  checkCatalog(catalog);
  const documents = new Map(catalog.sources.filter(s => s.reference).map(source =>
    [catalog.origin + '/' + source.reference.file, source]));
  const toolLinks = [], documentLinks = [];
  const routeIds = routes.map(routeId);
  for (const route of routes) {
    const target = routeId(route);
    for (const source of route.sources) {
      if (source.tool) toolLinks.push({ source: source.tool, target });
      const doc = documents.get(source.url);
      if (!doc) continue;
      const label = source.http ?? 'PUSH ' + route.label;
      if (source.digest !== doc.reference.sha256 || !doc.reference.routes.includes(label)) throw Error('REFERENCE_ROUTE_DRIFT');
      documentLinks.push({ source: doc.path, target, label });
    }
  }
  const references = createRecordRelation({ sources: [...documents.values()].map(doc => doc.path), targets: routeIds, links: documentLinks });
  for (const doc of documents.values()) {
    const declared = doc.reference.routes;
    const edges = references.from(doc.path);
    if (edges.length !== declared.length || !declared.every(label => edges.some(edge => edge.label === label))) throw Error('REFERENCE_ROUTE_MISSING');
  }
  const tools = createRecordRelation({ sources: catalog.tools.map(tool => tool.name), targets: routeIds, links: toolLinks });
  return { references, tools, routesById: new Map(routes.map(row => [routeId(row), row])) };
}

const limits = {
  default: 'Default', enum: 'Values', min: 'Minimum', max: 'Maximum', maximum: 'Maximum',
  minLength: 'Minimum length', maxLength: 'Maximum length', minItems: 'Minimum items', maxItems: 'Maximum items', pattern: 'Pattern',
};

export function httpFieldInventory(register, catalog) {
  checkCatalog(catalog);
  if (register?.schema !== 'moomoo-public-http-fields/v1' || register.authority !== false ||
      register.directory_sha256 !== catalog.directory_sha256) throw Error('FIELD_REGISTER_DRIFT');
  const rows = [];
  for (const tool of register.tools) {
    function add(field, section, parents = []) {
      const name = [...parents, field.name];
      rows.push({ tool: tool.name, section, label: name.join('.'), key: JSON.stringify([tool.name, section, ...name]),
        type: field.type ?? 'Unspecified', requirement: field.required === undefined ? 'Unspecified' : field.required ? 'Required' : 'Optional',
        rules: Object.entries(limits).filter(([key]) => Object.hasOwn(field, key)).map(([key, label]) =>
          label + ' ' + (Array.isArray(field[key]) ? field[key].join(', ') : String(field[key]))), wrap: tool.wrap });
      for (const child of field.fields ?? []) add(child, section, name);
    }
    for (const name of tool.path) add(tool.params.find(p => p.name === name) ?? { name }, 'Path');
    for (const field of tool.params) if (!tool.path.includes(field.name)) add(field, 'Parameter');
    for (const field of tool.body) add(field, 'Request body');
    for (const name of tool.response) add({ name }, 'Response');
    for (const name of tool.pagination ?? []) add({ name }, 'Pagination');
  }
  return rows;
}
