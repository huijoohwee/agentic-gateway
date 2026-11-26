// Local, read-only browser view of the package's verified reference index.
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { parseArgs } from 'node:util';
import { openReferenceIndex } from '../references.mjs';

const { values } = parseArgs({ options: { port: { type: 'string' } } });
const explicit = values.port ?? process.env.PORT;
const port = explicit ?? '4174';
if (!/^(0|[1-9][0-9]{0,4})$/.test(port) || Number(port) > 65535) throw Error('Expected a port from 0 to 65535');
const read = name => readFile(new URL('../references/' + name, import.meta.url), 'utf8');
const index = await read('index.json');
const pin = await read('pin.json');
const entries = (await openReferenceIndex(index, JSON.parse(pin))).list();
// The package validator restricts IDs, owners, revisions and paths to URL-safe characters.
const rows = entries.map(({ id, owner, revision, path }) =>
  '<li><a href="https://github.com/huijoohwee/' + owner + '/blob/' + revision + '/' + path + '">' + id + '</a> · ' + owner + '</li>');
const html = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>Gateway references</title><main><h1>Gateway references</h1><p><a href="/references/index.json">Reference index</a> · ' +
  '<a href="/references/pin.json">Index pin</a> · <a href="http://127.0.0.1:4173/">Design token catalog</a></p>' +
  '<p>Token profiles are owned and served by Agentic Design System. Start its local preview separately.</p>' +
  '<ul>' + rows.join('') + '</ul></main></html>';
const routes = new Map([['/', ['text/html', html]], ['/references/index.json', ['application/json', index]],
  ['/references/pin.json', ['application/json', pin]]]);
const server = createServer((request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) return response.writeHead(405, { Allow: 'GET, HEAD' }).end();
  const route = routes.get(request.url.split('?')[0]);
  if (!route) return response.writeHead(404).end();
  response.writeHead(200, { 'Content-Type': route[0] + '; charset=utf-8', 'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff' });
  response.end(request.method === 'HEAD' ? undefined : route[1]);
});
const host = '127.0.0.1';
server.once('listening', () => console.log('Gateway references at http://' + host + ':' + server.address().port + '/'));
server.once('error', error => {
  if (error.code === 'EADDRINUSE' && explicit === undefined) server.listen(0, host);
  else throw error;
});
server.listen(Number(port), host);
