/** Browser/Node transport for a locally operated OpenAI-compatible audio server. */
export const audioLimits = Object.freeze({ fileBytes: 8 * 1024 * 1024, waveBytes: 16 * 1024 * 1024, textChars: 4096 });
const formats = new Set(['wav', 'mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'ogg', 'flac', 'webm']);

function audioUrl(baseUrl, path) {
  const base = new URL(baseUrl);
  if (!['http:', 'https:'].includes(base.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)
      || base.username || base.password || base.search || base.hash || !/^\/v1\/?$/.test(base.pathname)) {
    throw new Error('Enter a loopback /v1 endpoint for a locally operated audio server.');
  }
  return new URL('/v1/audio/' + path, base);
}

function modelId(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 160) throw new Error('Enter the model ID served by the local endpoint.');
  return value.trim();
}

async function readBounded(response, limit) {
  if (!response.body || Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw new Error('Audio response is empty or exceeds the local size limit.');
  }
  const reader = response.body.getReader(), chunks = [];
  let total = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) { await reader.cancel(); throw new Error('Audio response exceeds the local size limit.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return new Blob(chunks);
}

async function post(url, init, signal, limit) {
  const timeout = AbortSignal.timeout(30_000);
  const response = await fetch(url, { ...init, method: 'POST', credentials: 'omit', redirect: 'error',
    cache: 'no-store', referrerPolicy: 'no-referrer', signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error('Local audio server returned HTTP ' + response.status + '.');
  }
  return readBounded(response, limit);
}

export async function transcribeAudio({baseUrl, model, file, signal}) {
  const url = audioUrl(baseUrl, 'transcriptions');
  if (!(file instanceof Blob) || !file.size || file.size > audioLimits.fileBytes || !formats.has(file.name?.split('.').at(-1)?.toLowerCase()))
    throw new Error('Choose a supported audio file up to 8 MiB.');
  const body = new FormData();
  body.set('model', modelId(model));
  body.set('response_format', 'json');
  body.set('file', file, file.name);
  const response = await post(url, {body}, signal, 256 * 1024);
  const result = JSON.parse(await response.text());
  if (typeof result?.text !== 'string') throw new Error('The transcription response is missing its text.');
  return result.text;
}

export async function synthesizeSpeech({baseUrl, model, input, voice, signal}) {
  const url = audioUrl(baseUrl, 'speech');
  if (typeof input !== 'string' || !input.trim() || input.length > audioLimits.textChars) throw new Error('Enter 1–4096 characters for speech.');
  if (typeof voice !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(voice)) throw new Error('Enter a stock voice ID supported by the local model.');
  const body = JSON.stringify({model: modelId(model), voice, input, response_format: 'wav'});
  const audio = await post(url, {body, headers: {'Content-Type':'application/json'}}, signal, audioLimits.waveBytes);
  const head = new Uint8Array(await audio.slice(0, 12).arrayBuffer());
  const tag = offset => String.fromCharCode(...head.subarray(offset, offset + 4));
  if (audio.size < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('The speech response is not a WAV file.');
  return audio.slice(0, audio.size, 'audio/wav');
}
