/* Pikafish browser UCI worker. The generated Emscripten module reuses this
 * script URL for its pthread workers through mainScriptUrlOrBlob.
 *
 * init: { type: 'init', jsUrl, wasmUrl, netUrl }
 *   Fetches the NNUE net first (progress messages carry loaded/total bytes),
 *   writes it into the module's in-memory filesystem as /pikafish.nnue, then
 *   builds the engine, whose default EvalFile resolves to that path.
 * command: { type: 'command', command } — one UCI line. */

let command = null;

async function verifySha256(bytes, expected, label) {
  if (!expected) return;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const actual = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  if (actual !== expected) throw new Error(`${label} SHA-256 校验失败`);
}

async function fetchNet(url, expectedSha256) {
  const response = await fetch(url, { cache: 'force-cache' });
  if (!response.ok) throw new Error(`NNUE 下载失败：HTTP ${response.status}`);
  const total = Number(response.headers.get('content-length')) || 0;
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    self.postMessage({ type: 'asset-progress', asset: 'nnue', loaded: bytes.byteLength, total });
    self.postMessage({ type: 'status', text: '正在校验棋力网络…' });
    await verifySha256(bytes, expectedSha256, 'NNUE');
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    self.postMessage({ type: 'asset-progress', asset: 'nnue', loaded, total });
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  await verifySha256(bytes, expectedSha256, 'NNUE');
  return bytes;
}

async function fetchWasm(url, expectedSha256) {
  const response = await fetch(url, { cache: 'force-cache' });
  if (!response.ok) throw new Error(`WASM 下载失败：HTTP ${response.status}`);
  const total = Number(response.headers.get('content-length')) || 0;
  if (!response.body) {
    const bytes = await response.arrayBuffer();
    self.postMessage({ type: 'asset-progress', asset: 'wasm', loaded: bytes.byteLength, total });
    self.postMessage({ type: 'status', text: '正在校验 WebAssembly 文件…' });
    await verifySha256(bytes, expectedSha256, 'WASM');
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    self.postMessage({ type: 'asset-progress', asset: 'wasm', loaded, total });
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  self.postMessage({ type: 'status', text: '正在校验 WebAssembly 文件…' });
  await verifySha256(bytes, expectedSha256, 'WASM');
  return bytes.buffer;
}

self.addEventListener('message', async (event) => {
  const message = event.data;
  if (message?.type === 'init') {
    try {
      self.postMessage({ type: 'status', text: '正在下载 Pikafish 棋力网络和 WebAssembly 文件…' });
      const netPromise = fetchNet(message.netUrl, message.netSha256);
      const wasmPromise = fetchWasm(message.wasmUrl, message.wasmSha256);
      importScripts(message.jsUrl);
      const factory = self.Pikafish;
      if (typeof factory !== 'function') {
        throw new Error('Pikafish factory missing after script load');
      }
      const [net, wasmBinary] = await Promise.all([netPromise, wasmPromise]);
      self.postMessage({ type: 'status', text: '下载完成，正在初始化 Pikafish…' });
      const module = await factory({
        wasmBinary,
        locateFile: (file) => (file.endsWith('.wasm') ? message.wasmUrl : file),
        mainScriptUrlOrBlob: message.jsUrl,
        print: (line) => self.postMessage({ type: 'line', line: String(line) }),
        printErr: (line) => self.postMessage({ type: 'stderr', line: String(line) }),
      });
      module.FS.writeFile('/pikafish.nnue', net);
      self.postMessage({ type: 'net-written', bytes: net.byteLength });
      const initialize = module.cwrap('pikafish_initialize', null, []);
      command = module.cwrap('pikafish_command', null, ['string']);
      initialize();
      self.postMessage({ type: 'ready' });
    } catch (error) {
      self.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  if (message?.type === 'command' && typeof message.command === 'string') {
    if (!command) {
      self.postMessage({ type: 'error', message: 'Pikafish worker is not ready' });
      return;
    }
    command(message.command);
  }
});
