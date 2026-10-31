const pieceMap = { K: 'K', A: 'A', E: 'B', R: 'R', H: 'N', C: 'C', P: 'P' };

export function boardToFen(board, side) {
  const rows = [];
  // FEN rows run from the black side (app rank 0) toward the red side (rank 9).
  // Keep piece casing too: uppercase pieces are red in the app and in Pikafish FEN.
  for (let rank = 0; rank < 10; rank += 1) {
    let row = '';
    let empty = 0;
    for (let file = 0; file < 9; file += 1) {
      const piece = board[rank * 9 + file];
      if (!piece) { empty += 1; continue; }
      if (empty) { row += empty; empty = 0; }
      const fenPiece = pieceMap[piece.toUpperCase()];
      if (!fenPiece) throw new Error(`无法转换棋子：${piece}`);
      row += piece === piece.toUpperCase() ? fenPiece : fenPiece.toLowerCase();
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return `${rows.join('/')} ${side === 'red' ? 'w' : 'b'} - - 0 1`;
}

export function engineMoveToICCS(move) {
  if (typeof move !== 'string' || !/^[a-i][0-9][a-i][0-9]$/.test(move)) throw new Error(`无效的 Pikafish 着法：${move}`);
  return `${move[0]}${9 - Number(move[1])}${move[2]}${9 - Number(move[3])}`;
}

export function parseUciInfoLine(line) {
  if (!line.startsWith('info ')) return null;
  const depth = Number(line.match(/\bdepth (\d+)/)?.[1] ?? 0);
  const multipv = Number(line.match(/\bmultipv (\d+)/)?.[1] ?? 1);
  const scoreMatch = line.match(/\bscore (cp|mate) (-?\d+)/);
  const wdlMatch = line.match(/\bwdl (\d+) (\d+) (\d+)/);
  return {
    depth,
    multipv,
    score: scoreMatch ? { type: scoreMatch[1], value: Number(scoreMatch[2]) } : null,
    wdl: wdlMatch ? { win: Number(wdlMatch[1]), draw: Number(wdlMatch[2]), loss: Number(wdlMatch[3]) } : null,
  };
}

export function toRedPerspective(line, side) {
  const sign = side === 'red' ? 1 : -1;
  return {
    score: line?.score ? { ...line.score, value: line.score.value * sign } : null,
    wdl: line?.wdl ? {
      win: sign > 0 ? line.wdl.win : line.wdl.loss,
      draw: line.wdl.draw,
      loss: sign > 0 ? line.wdl.loss : line.wdl.win,
    } : null,
  };
}

export function formatRedEvaluation(line, side) {
  if (!line) return '红方 score cp — · WDL 胜 — 和 — 负 —';
  const { score, wdl } = toRedPerspective(line, side);
  const scoreText = score?.type === 'cp'
    ? `score cp ${score.value > 0 ? '+' : ''}${score.value}`
    : score?.type === 'mate' ? `mate ${score.value > 0 ? '+' : ''}${score.value}` : 'score cp —';
  const percent = (value) => `${(value / 10).toFixed(1).replace(/\.0$/, '')}%`;
  const wdlText = wdl ? `胜 ${percent(wdl.win)} 和 ${percent(wdl.draw)} 负 ${percent(wdl.loss)}` : '胜 — 和 — 负 —';
  return `红方 ${scoreText} · WDL ${wdlText}`;
}

const asset = (name, version = '') => {
  const url = new URL(`./dist/${name}`, import.meta.url);
  if (version) url.searchParams.set('v', version);
  return url.href;
};
const UPDATE_FEED = 'https://raw.githubusercontent.com/wuxiancai/xiangqi/engine-updates/manifest.json';

async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function loadEngineAssets(onUpdate = () => {}) {
  onUpdate({ type: 'status', text: '正在检查 Pikafish 更新…' });
  let localVersion = null;
  try {
    const response = await fetch(asset('version.json'), { cache: 'no-store' });
    if (response.ok) localVersion = await response.json();
  } catch {}

  let latest = null;
  let latestError = null;
  try {
    const response = await fetch(UPDATE_FEED, { cache: 'no-store' });
    if (!response.ok) throw new Error(`版本清单 HTTP ${response.status}`);
    latest = await response.json();
    if (latest.schema !== 'chuhe-pikafish/v1' || latest.engine_api !== 1 || !latest.base_url || !latest.assets) {
      throw new Error('版本清单格式不受支持');
    }
    if (latest.commit === localVersion?.commit && latest.net_sha256 === localVersion?.net_sha256) {
      onUpdate({ type: 'status', text: '正在准备已缓存的引擎资源…' });
      return localAssets(localVersion);
    }
    return await manifestAssets(latest, onUpdate);
  } catch (error) {
    latestError = error;
  }
  if (latest?.fallback) {
    try { return await manifestAssets(latest.fallback, onUpdate); }
    catch (fallbackError) { latestError = new Error(`${latestError.message}；回退版本也不可用：${fallbackError.message}`); }
  }
  if (localVersion) {
    onUpdate({ type: 'status', text: '在线版本暂不可用，正在准备本机引擎…' });
    return localAssets(localVersion);
  }
  throw new Error(`无法检查或下载最新 Pikafish：${latestError?.message ?? '版本服务不可用'}`);
}

async function manifestAssets(manifest, onUpdate = () => {}) {
  if (!manifest.base_url || !manifest.assets) throw new Error('引擎版本清单缺少资源地址');
  const base = new URL(manifest.base_url);
  if (base.origin !== 'https://raw.githubusercontent.com' || !base.pathname.startsWith('/wuxiancai/xiangqi/engine-updates/releases/')) {
    throw new Error('引擎资源必须来自项目官方 Raw CDN');
  }
  const wasmUrl = verifiedAssetUrl(manifest.base_url, 'pikafish.wasm', manifest.assets['pikafish.wasm']);
  const netUrl = verifiedAssetUrl(manifest.base_url, 'pikafish.nnue', manifest.assets['pikafish.nnue']);
  const js = await verifiedScript(manifest.base_url, manifest.assets['pikafish.js'], onUpdate);
  return {
    version: manifest,
    jsUrl: js,
    wasmUrl,
    wasmSha256: manifest.assets['pikafish.wasm']?.sha256,
    netUrl,
    netSha256: manifest.assets['pikafish.nnue']?.sha256,
  };
}

function verifiedAssetUrl(baseUrl, filename, descriptor) {
  if (!/^[a-f0-9]{64}$/i.test(descriptor?.sha256 ?? '')) throw new Error(`引擎清单缺少有效的 ${filename} SHA-256`);
  const url = new URL(filename, baseUrl);
  url.searchParams.set('sha256', descriptor.sha256);
  return url.href;
}

async function verifiedScript(baseUrl, descriptor, onUpdate) {
  const url = verifiedAssetUrl(baseUrl, 'pikafish.js', descriptor);
  onUpdate({ type: 'status', text: '正在下载引擎程序…' });
  const response = await fetch(url, { cache: 'force-cache' });
  if (!response.ok) throw new Error(`引擎脚本 HTTP ${response.status}`);
  const total = Number(response.headers.get('content-length')) || 0;
  let bytes;
  if (!response.body) {
    bytes = await response.arrayBuffer();
    onUpdate({ type: 'progress', asset: 'js', loaded: bytes.byteLength, total });
  } else {
    const reader = response.body.getReader();
    const chunks = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      onUpdate({ type: 'progress', asset: 'js', loaded, total });
    }
    bytes = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  }
  onUpdate({ type: 'status', text: '正在校验引擎程序…' });
  if (await sha256(bytes) !== descriptor.sha256) throw new Error('引擎脚本 SHA-256 校验失败');
  return URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }));
}

function localAssets(version) {
  const cacheVersion = version?.commit
    ? `${version.commit.slice(0, 12)}-${(version.net_sha256 || '').slice(0, 12)}`
    : `local-${Date.now()}`;
  return {
    version,
    jsUrl: asset('pikafish.js', cacheVersion),
    wasmUrl: asset('pikafish.wasm', cacheVersion),
    wasmSha256: null,
    netUrl: asset('pikafish.nnue', cacheVersion),
    netSha256: version?.net_sha256,
  };
}

export class PikafishEngine {
  constructor(onUpdate = () => {}) {
    this.onUpdate = onUpdate;
    this.worker = null;
    this.ready = false;
    this.pending = null;
    this.queued = null;
    this.analysisId = 0;
    this.lines = [];
    this.version = null;
    this.objectUrls = [];
  }

  async start() {
    if (globalThis.isSecureContext !== true) return Promise.reject(new Error('Pikafish 多线程引擎要求安全上下文；公网请使用 HTTPS 域名访问，HTTP 仅 localhost 可用'));
    if (globalThis.crossOriginIsolated !== true) return Promise.reject(new Error('当前页面未完成跨域隔离；请确保 HTML 响应包含 COOP: same-origin 和 COEP: require-corp，检查反向代理是否转发响应头'));
    if (this.worker) return this.ready ? Promise.resolve() : Promise.reject(new Error('Pikafish 正在初始化'));
    const assets = await loadEngineAssets((message) => this.onUpdate(message));
    this.onUpdate({ type: 'status', text: '正在启动 WebAssembly 引擎…' });
    const workerUrl = new URL('./worker.js?v=engine-runtime-guard-1', import.meta.url);
    const workerResponse = await fetch(workerUrl, { method: 'HEAD', cache: 'no-store' });
    if (!workerResponse.ok) throw new Error(`引擎 Worker 不可用（HTTP ${workerResponse.status}）`);
    this.version = assets.version;
    if (assets.jsUrl.startsWith('blob:')) this.objectUrls.push(assets.jsUrl);
    try {
      await this.#startWorker(workerUrl, assets);
    } catch (error) {
      if (!assets.version?.fallback) throw error;
      this.worker?.terminate(); this.worker = null; this.ready = false;
      if (assets.jsUrl.startsWith('blob:')) {
        URL.revokeObjectURL(assets.jsUrl);
        this.objectUrls = this.objectUrls.filter((url) => url !== assets.jsUrl);
      }
      this.onUpdate({ type: 'status', text: '最新引擎校验或启动失败，正在回退上一版本…' });
      const fallback = await manifestAssets(assets.version.fallback, (message) => this.onUpdate(message));
      this.version = fallback.version;
      if (fallback.jsUrl.startsWith('blob:')) this.objectUrls.push(fallback.jsUrl);
      await this.#startWorker(workerUrl, fallback);
    }
  }

  #startWorker(workerUrl, assets) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(workerUrl);
      this.worker = worker;
      const timer = setTimeout(() => reject(new Error('引擎初始化超时')), 120000);
      worker.onmessage = ({ data }) => {
        if (data.type === 'ready') {
          worker.postMessage({ type: 'command', command: 'uci' });
          this.onUpdate({ type: 'status', text: '引擎已加载，正在握手…' });
        } else if (data.type === 'asset-progress') {
          this.onUpdate({ type: 'progress', asset: data.asset, loaded: data.loaded, total: data.total });
        } else if (data.type === 'status') {
          this.onUpdate({ type: 'status', text: data.text });
        } else if (data.type === 'line') {
          if (this.pending && !this.pending.stopping) this.#resetSearchWatchdog(this.pending);
          this.#line(data.line);
          if (data.line === 'uciok' && !this.ready) {
            const threads = Math.max(1, Math.min(8, Number(navigator.hardwareConcurrency) || 1));
            worker.postMessage({ type: 'command', command: `setoption name Threads value ${threads}` });
            worker.postMessage({ type: 'command', command: 'setoption name Hash value 256' });
            worker.postMessage({ type: 'command', command: 'setoption name UCI_ShowWDL value true' });
            worker.postMessage({ type: 'command', command: 'isready' });
          } else if (data.line === 'readyok' && !this.ready) {
            this.ready = true;
            clearTimeout(timer);
            this.onUpdate({ type: 'ready' });
            resolve();
          }
        } else if (data.type === 'error') {
          const error = new Error(data.message || 'Pikafish 初始化失败');
          if (this.ready) this.#failWorker(error);
          else { clearTimeout(timer); reject(error); }
        }
      };
      worker.onmessageerror = () => {
        const error = new Error('Pikafish Worker 消息解析失败');
        if (this.ready) this.#failWorker(error);
        else { clearTimeout(timer); reject(error); }
      };
      worker.onerror = (event) => {
        const error = new Error(event.message || 'Pikafish Worker 运行失败');
        if (this.ready) this.#failWorker(error);
        else { clearTimeout(timer); reject(error); }
      };
      worker.postMessage({ type: 'init', ...assets });
    });
  }

  #line(line) {
    if (line.startsWith('info ')) {
      const info = parseUciInfoLine(line);
      const pv = line.match(/\bpv (.+)$/)?.[1]?.split(/\s+/) ?? [];
      if (pv.length && this.pending) {
        const item = { ...info, pv };
        this.pending.lines.set(info.multipv, item);
        this.onUpdate({ type: 'analysis', analysisId: this.pending.id, board: this.pending.board, side: this.pending.side, lines: [...this.pending.lines.values()].sort((a, b) => a.multipv - b.multipv) });
      }
      return;
    }
    if (line.startsWith('bestmove ')) {
      const bestmove = line.split(/\s+/)[1];
      if (this.pending) {
        const finished = this.pending;
        clearTimeout(finished.watchdog);
        clearTimeout(finished.stopWatchdog);
        this.pending = null;
        finished.resolve(bestmove);
        if (this.queued) {
          const next = this.queued;
          this.queued = null;
          this.#startAnalysis(next);
        }
      }
    }
  }

  // Supersede an in-flight position with the newest request after UCI stops.
  analyze(board, side, { depth = 30, moveTime = null, multiPv = 1 } = {}) {
    if (!this.ready) return Promise.reject(new Error('Pikafish 尚未就绪'));
    const request = { id: ++this.analysisId, board: [...board], side, depth, moveTime, multiPv, lines: new Map() };
    const promise = new Promise((resolve, reject) => { request.resolve = resolve; request.reject = reject; });
    promise.analysisId = request.id;
    if (this.pending) {
      if (this.queued) {
        const error = new Error('分析请求已被更新局面取代'); error.name = 'AbortError';
        this.queued.reject(error);
      }
      this.queued = request;
      this.#stopPending();
    } else this.#startAnalysis(request);
    return promise;
  }

  #startAnalysis(request) {
    this.pending = request;
    this.#resetSearchWatchdog(request);
    const searchCommand = request.moveTime
      ? `go movetime ${Math.max(1, Math.trunc(request.moveTime))}`
      : `go depth ${request.depth}`;
    try {
      this.worker.postMessage({ type: 'command', command: `setoption name MultiPV value ${request.multiPv}` });
      this.worker.postMessage({ type: 'command', command: `position fen ${boardToFen(request.board, request.side)}` });
      this.worker.postMessage({ type: 'command', command: searchCommand });
    } catch (error) {
      this.#failWorker(new Error(`无法启动引擎搜索：${error.message}`));
    }
  }

  #resetSearchWatchdog(request) {
    clearTimeout(request.watchdog);
    const timeout = request.moveTime
      ? Math.max(15000, Math.min(request.moveTime + 15000, 180000))
      : 120000;
    if (request.moveTime) request.deadline ??= Date.now() + timeout;
    const delay = request.moveTime ? Math.max(0, request.deadline - Date.now()) : timeout;
    request.watchdog = setTimeout(() => {
      if (this.pending !== request) return;
      this.#failWorker(new Error(`搜索超过 ${Math.round(timeout / 1000)} 秒仍未结束，已停止引擎`));
    }, delay);
  }

  #stopPending() {
    const request = this.pending;
    if (!request || !this.worker) return;
    request.stopping = true;
    clearTimeout(request.watchdog);
    clearTimeout(request.stopWatchdog);
    request.stopWatchdog = setTimeout(() => {
      if (this.pending === request) this.#failWorker(new Error('引擎未响应停止命令，已停止引擎'));
    }, 10000);
    try {
      this.worker.postMessage({ type: 'command', command: 'stop' });
    } catch (error) {
      this.#failWorker(new Error(`无法停止引擎：${error.message}`));
    }
  }

  #failWorker(error) {
    const failedWorker = this.worker;
    failedWorker?.terminate();
    this.worker = null;
    this.ready = false;
    if (this.pending) {
      clearTimeout(this.pending.watchdog);
      clearTimeout(this.pending.stopWatchdog);
      this.pending.reject(error);
      this.pending = null;
    }
    this.queued?.reject(error);
    this.queued = null;
    this.onUpdate({ type: 'runtime-error', message: error.message });
  }

  stop() {
    this.#stopPending();
  }

  close() {
    const error = new Error('Pikafish 已关闭'); error.name = 'AbortError';
    if (this.pending) clearTimeout(this.pending.watchdog);
    if (this.pending) clearTimeout(this.pending.stopWatchdog);
    this.pending?.reject(error);
    this.queued?.reject(error);
    this.worker?.terminate();
    for (const url of this.objectUrls) URL.revokeObjectURL(url);
    this.objectUrls = [];
    this.worker = null;
    this.ready = false;
    this.pending = null;
    this.queued = null;
  }

}
