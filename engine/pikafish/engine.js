const pieceMap = { K: 'K', A: 'A', E: 'B', R: 'R', H: 'N', C: 'C', P: 'P' };

export function boardToFen(board, side) {
  const rows = [];
  for (let rank = 9; rank >= 0; rank -= 1) {
    let row = '';
    let empty = 0;
    for (let file = 0; file < 9; file += 1) {
      const piece = board[rank * 9 + file];
      if (!piece) { empty += 1; continue; }
      if (empty) { row += empty; empty = 0; }
      const fenPiece = pieceMap[piece.toUpperCase()];
      if (!fenPiece) throw new Error(`无法转换棋子：${piece}`);
      row += piece === piece.toUpperCase() ? fenPiece.toLowerCase() : fenPiece;
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

const asset = (name) => new URL(`./dist/${name}`, import.meta.url).href;

export class PikafishEngine {
  constructor(onUpdate = () => {}) {
    this.onUpdate = onUpdate;
    this.worker = null;
    this.ready = false;
    this.pending = null;
    this.queued = null;
    this.analysisId = 0;
    this.lines = [];
  }

  start() {
    if (globalThis.crossOriginIsolated !== true) return Promise.reject(new Error('当前站点未启用 COOP/COEP，无法启动多线程引擎；请使用项目自托管服务或配置隔离响应头'));
    if (this.worker) return this.ready ? Promise.resolve() : Promise.reject(new Error('Pikafish 正在初始化'));
    const requiredAssets = ['worker.js', 'pikafish.js', 'pikafish.wasm', 'pikafish.nnue'];
    return Promise.all(requiredAssets.map(async (name) => {
      const response = await fetch(asset(name), { method: 'HEAD', cache: 'no-store' });
      if (!response.ok) throw new Error(`引擎资源 ${name} 不可用（HTTP ${response.status}）；请先运行 bash engine/pikafish/build.sh`);
    })).then(() => new Promise((resolve, reject) => {
      const worker = new Worker(asset('worker.js'));
      this.worker = worker;
      const timer = setTimeout(() => reject(new Error('引擎初始化超时')), 120000);
      worker.onmessage = ({ data }) => {
        if (data.type === 'ready') {
          worker.postMessage({ type: 'command', command: 'uci' });
          this.onUpdate({ type: 'status', text: '引擎已加载，正在握手…' });
        } else if (data.type === 'net-progress') {
          this.onUpdate({ type: 'progress', loaded: data.loaded, total: data.total });
        } else if (data.type === 'line') {
          this.#line(data.line);
          if (data.line === 'uciok' && !this.ready) {
            worker.postMessage({ type: 'command', command: 'isready' });
          } else if (data.line === 'readyok' && !this.ready) {
            this.ready = true;
            clearTimeout(timer);
            resolve();
          }
        } else if (data.type === 'error') {
          clearTimeout(timer);
          reject(new Error(data.message || 'Pikafish 初始化失败'));
        }
      };
      worker.onerror = (event) => { clearTimeout(timer); reject(new Error(event.message || 'Pikafish Worker 加载失败')); };
      worker.postMessage({ type: 'init', jsUrl: asset('pikafish.js'), wasmUrl: asset('pikafish.wasm'), netUrl: asset('pikafish.nnue') });
    }));
  }

  #line(line) {
    if (line.startsWith('info ')) {
      const depth = Number(line.match(/\bdepth (\d+)/)?.[1] ?? 0);
      const score = line.match(/\bscore (cp|mate) (-?\d+)/);
      const pv = line.match(/\bpv (.+)$/)?.[1]?.split(/\s+/) ?? [];
      if (pv.length && this.pending) {
        const item = { depth, score: score ? { type: score[1], value: Number(score[2]) } : null, pv };
        const key = pv[0];
        this.pending.lines.set(key, item);
        this.onUpdate({ type: 'analysis', analysisId: this.pending.id, board: this.pending.board, side: this.pending.side, lines: [...this.pending.lines.values()].sort((a, b) => b.depth - a.depth).slice(0, 5) });
      }
      return;
    }
    if (line.startsWith('bestmove ')) {
      const bestmove = line.split(/\s+/)[1];
      if (this.pending) {
        const finished = this.pending;
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
  analyze(board, side, { depth = 14, multiPv = 3 } = {}) {
    if (!this.ready) return Promise.reject(new Error('Pikafish 尚未就绪'));
    const request = { id: ++this.analysisId, board: [...board], side, depth, multiPv, lines: new Map() };
    const promise = new Promise((resolve, reject) => { request.resolve = resolve; request.reject = reject; });
    promise.analysisId = request.id;
    if (this.pending) {
      if (this.queued) {
        const error = new Error('分析请求已被更新局面取代'); error.name = 'AbortError';
        this.queued.reject(error);
      }
      this.queued = request;
      this.worker.postMessage({ type: 'command', command: 'stop' });
    } else this.#startAnalysis(request);
    return promise;
  }

  #startAnalysis(request) {
    this.pending = request;
    this.worker.postMessage({ type: 'command', command: `setoption name MultiPV value ${request.multiPv}` });
    this.worker.postMessage({ type: 'command', command: `position fen ${boardToFen(request.board, request.side)}` });
    this.worker.postMessage({ type: 'command', command: `go depth ${request.depth}` });
  }

  stop() {
    if (this.pending) this.worker?.postMessage({ type: 'command', command: 'stop' });
  }

  close() {
    const error = new Error('Pikafish 已关闭'); error.name = 'AbortError';
    this.pending?.reject(error);
    this.queued?.reject(error);
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
    this.pending = null;
    this.queued = null;
  }

}
