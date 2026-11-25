// Browser access happens only when a host invokes a transfer from a user action.
export async function openSaveFilePickerHandle(suggestedName, options, host = globalThis.window) {
  if (typeof host?.showSaveFilePicker !== 'function') return null;
  try {
    return await host.showSaveFilePicker({ suggestedName, types: [options] });
  } catch (error) {
    return error?.name === 'AbortError' ? '' : null;
  }
}

async function writeBlob(handle, blob) {
  const stream = await handle.createWritable();
  try {
    await stream.write(blob);
    await stream.close();
  } catch (error) {
    try { await stream.abort?.(); } catch { /* Retain the original write failure. */ }
    throw error;
  }
}

export async function writeBlobToFileHandle(handle, blob) {
  try { await writeBlob(handle, blob); return true; } catch { return false; }
}

export async function saveBlobWithPicker(blob, suggestedName, options, host) {
  const handle = await openSaveFilePickerHandle(suggestedName, options, host);
  if (!handle) return handle;
  try {
    await writeBlob(handle, blob);
    return handle.name || suggestedName;
  } catch (error) {
    return error?.name === 'AbortError' ? '' : null;
  }
}

export function downloadBlob(blob, filename, doc = globalThis.window?.document) {
  if (!doc) return;
  const host = doc.defaultView ?? globalThis;
  const anchor = doc.createElement('a');
  const url = host.URL.createObjectURL(blob);
  try {
    anchor.href = url;
    anchor.download = filename;
    doc.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    host.setTimeout(() => host.URL.revokeObjectURL(url), 1000);
  }
}

// The host explicitly chooses whether its primary importer can fall back after a failure.
export async function importWithFallback({ primary, fallback, accepts, recover }) {
  if (primary) {
    let result;
    try { result = await primary(); }
    catch (error) {
      if (!recover?.(error)) throw error;
      return fallback();
    }
    if (accepts(result)) return result;
  }
  return fallback();
}
