import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { synthesizeSpeech, transcribeAudio } from '../connectors/openai-audio.mjs';

test('the two audio contracts round-trip over loopback and reject unsafe or mismatched responses', async t => {
  const wave = Buffer.alloc(46);
  wave.write('RIFF'); wave.writeUInt32LE(38, 4); wave.write('WAVEfmt ', 8); wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22); wave.writeUInt32LE(8000, 24);
  wave.writeUInt32LE(16000, 28); wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34);
  wave.write('data', 36); wave.writeUInt32LE(2, 40);
  const requests = [];
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    if (req.url === '/v1/audio/transcriptions') {
      const form = await new Response(raw, {headers: req.headers}).formData();
      requests.push([req.url, form.get('model'), form.get('response_format'), form.get('file').name, form.get('file').size]);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({text: 'Diagram Intake → Review'}));
    } else if (req.url === '/v1/audio/speech') {
      const data = JSON.parse(raw);
      requests.push([req.url, data]);
      if (data.input === 'broken') { res.end('invalid wave'); return; }
      if (data.input === 'redirect') { res.writeHead(307, {Location: '/unexpected'}).end(); return; }
      res.setHeader('Content-Type', 'audio/wav');
      res.end(wave);
    } else res.writeHead(404).end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const baseUrl = 'http://127.0.0.1:' + server.address().port + '/v1';
  const file = new File([wave], 'clip.wav', {type: 'audio/wav'});
  assert.equal(await transcribeAudio({baseUrl, model: 'local-asr', file}), 'Diagram Intake → Review');
  const input = {baseUrl, model: 'local-tts', voice: 'alloy', input: 'Review'};
  const result = await synthesizeSpeech(input);
  assert.equal(result.type, 'audio/wav');
  assert.deepEqual(Buffer.from(await result.arrayBuffer()), wave);
  assert.deepEqual(requests, [
    ['/v1/audio/transcriptions', 'local-asr', 'json', 'clip.wav', wave.length],
    ['/v1/audio/speech', {model: 'local-tts', voice: 'alloy', input: 'Review', response_format: 'wav'}],
  ]);
  await assert.rejects(synthesizeSpeech({...input, input:'broken'}), /WAV/);
  await assert.rejects(synthesizeSpeech({...input, input:'redirect'}));
  await assert.rejects(synthesizeSpeech({...input, baseUrl:'https://api.openai.com/v1'}), /loopback/);
  await assert.rejects(synthesizeSpeech({...input, signal: AbortSignal.abort()}), {name:'AbortError'});
  await assert.rejects(transcribeAudio({baseUrl, model:'local-asr', file:new File([wave], 'clip.txt')}), /supported/);
});
