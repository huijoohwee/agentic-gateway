import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import test from 'node:test';

test('dev serves the verified index, pin and browser view on loopback', { timeout: 10000 }, async t => {
  const child = spawn(process.execPath, ['tools/dev.mjs', '--port', '0'], { stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
  });
  const [line] = await once(createInterface({ input: child.stdout }), 'line');
  const url = line.match(/http:\/\/127\.0\.0\.1:\d+\//)[0];
  assert.match(await (await fetch(url)).text(), /guideline\/prd-tad-adr-mvp-gtm/);
  for (const name of ['index.json', 'pin.json']) {
    assert.equal(await (await fetch(url + 'references/' + name)).text(), await readFile('references/' + name, 'utf8'));
  }
  assert.equal((await fetch(url + 'package.json')).status, 404);
  assert.equal((await fetch(url, { method: 'POST' })).status, 405);
});
