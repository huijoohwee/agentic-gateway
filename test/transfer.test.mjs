import test from 'node:test';
import assert from 'node:assert/strict';
import {createPageCaptureStore, readCopiedPage} from 'agentic-gateway/transfer/copied-page';
import {importWithFallback, saveBlobWithPicker, downloadBlob} from 'agentic-gateway/transfer/browser-files';

test('record exports preserve full cell values, quoted rows, numeric measures and pivot orientation', async () => {
  const { serializeRecordView } = await import('agentic-gateway/transfer/record-export')
  const data = { name: 'Records', columns: [{ name: 'Label' }, { name: 'Value' }],
    rows: [{ cells: ['a,"b"\nnext', -2] }, { cells: ['a|b', '=1+1'] }] }
  assert.equal(serializeRecordView(data, 'csv'), '"Label","Value"\r\n"a,""b""\nnext","-2"\r\n"a|b","\'=1+1"\r\n')
  assert.deepEqual(JSON.parse(serializeRecordView(data, 'json')), { columns: ['Label', 'Value'], rows: data.rows.map(row => row.cells) })
  assert.equal(serializeRecordView(data, 'markdown'), '| Label | Value |\n| --- | --- |\n| a,"b"<br>next | -2 |\n| a\\|b | =1+1 |\n')
  const pivot = JSON.parse(serializeRecordView({ ...data, orientation: 'columns' }, 'json'))
  assert.deepEqual(pivot.columns, ['Field', 'a,"b"\nnext', 'a|b'])
  assert.deepEqual(pivot.rows[1], ['Value', -2, '=1+1'])
  assert.deepEqual(JSON.parse(serializeRecordView({ ...data, rows: [] }, 'json')).rows, [])
  assert.throws(() => serializeRecordView({ ...data, rows: [{ cells: [] }] }, 'csv'), /columns/)
})

test('copied page imports keep source identity, byte limits and one-time consumption per host', async () => {
  const store = createPageCaptureStore({maxBytes: 128});
  const url = 'https://example.test/doc?q=abc';
  const html = '<title>Notes</title><p>笔记</p>';
  const copied = await readCopiedPage({read: async () => [{types:['text/html'], getType: async () => new Blob([html])}]});
  const capture = store.stage(url + '#heading', copied.html, copied.text);
  const other = createPageCaptureStore({maxBytes: 128});
  assert.throws(() => other.consume(capture.requestUrl), /expired/);
  assert.deepEqual(store.consume(capture.requestUrl), {sourceUrl: url, html, title: 'Notes'});
  assert.throws(() => store.consume(capture.requestUrl), /expired/);
  assert.equal(store.consume(url), null);
  const pasted = store.stage(url, '', '<input>');
  assert.match(store.consume(pasted.requestUrl).html, /&lt;input&gt;/);
  assert.throws(() => store.stage(url, '界'.repeat(50)), /limit/);
  assert.throws(() => store.stage('https://user@example.test', html), /credentials/);
  const wrong = store.stage(url, html);
  assert.throws(() => store.consume(wrong.requestUrl.replace('/doc', '/else')), /matches/);
});

test('host imports determine acceptance and recoverable errors', async () => {
  let count = 0;
  const opts = {fallback: () => ++count, accepts: value => value === 42};
  assert.equal(await importWithFallback({...opts, primary: () => 42}),42);
  assert.equal(await importWithFallback({...opts, primary: () => null}),1);
  const primary = () => { throw Error('unavailable'); };
  await assert.rejects(importWithFallback({...opts, primary}), /unavailable/);
  assert.equal(await importWithFallback({...opts, primary, recover: () => true}),2);
});

test('picker preserves cancellation, writes once, and download revokes its object URL', async () => {
  const blob = new Blob(['example']);
  let written, closed = 0;
  const opts = {description: 'Document', accept: {'text/plain':['.txt']}};
  const picker = {showSaveFilePicker: async () => ({name: 'saved.txt', createWritable: async () => ({
    write: value => { written = value; }, close: () => { closed++; }
  })})};
  assert.equal(await saveBlobWithPicker(blob, 'doc.txt', opts, picker), 'saved.txt');
  assert.equal(written,blob); assert.equal(closed,1);
  assert.equal(await saveBlobWithPicker(blob,'doc.txt',opts,{}),null);
  assert.equal(await saveBlobWithPicker(blob,'doc.txt',opts,{showSaveFilePicker(){throw new DOMException('', 'AbortError');}}),'');
  const events = [], anchor = {click(){ events.push(this.download); }, remove(){ events.push('remove'); }};
  const doc = { defaultView: {URL:{createObjectURL:()=>'blob:sample',revokeObjectURL:x=>events.push(x)},setTimeout:fn=>fn()},
    createElement:()=>anchor, body:{appendChild:()=>events.push('append')} };
  downloadBlob(blob,'test.glb',doc);
  assert.deepEqual(events,['append','test.glb','remove','blob:sample']);
});
