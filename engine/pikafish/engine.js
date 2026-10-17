const pieceMap = { K: 'K', A: 'A', E: 'B', R: 'R', H: 'N', C: 'C', P: 'P' };

export function boardToFen(board, side) {
  const rows = [];
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

const asset = (name) => new URL(`./dist/${name}`, import.meta.url).href;

export class PikafishEngine {
  constructor(onUpdate = () => {}) {
    this.onUpdate = onUpdate;
    this.worker = null;
    this.ready = false;
    this.pending = null;
    this.lines = [];
  }

  start() {
    if (globalThis.crossOriginIsolated !== true) return Promise.reject(new Error('当前站点未启用 COOP/COEP，无法启动多线程引擎；请使用项目自托管服务或配置隔离响应头'));
    if (this.worker) return this.ready ? Promise.resolve() : Promise.reject(new Error('Pikafish 正在初始化'));
    return new Promise((resolve, reject) => {
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
    });
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
        this.onUpdate({ type: 'analysis', lines: [...this.pending.lines.values()].sort((a, b) => b.depth - a.depth).slice(0, 5) });
      }
      return;
    }
    if (line.startsWith('bestmove ')) {
      const bestmove = line.split(/\s+/)[1];
      if (this.pending) { this.pending.resolve(bestmove); this.pending = null; }
    }
  }

  analyze(board, side, { depth = 14, multiPv = 3 } = {}) {
    if (!this.ready) return Promise.reject(new Error('Pikafish 尚未就绪'));
    if (this.pending) return Promise.reject(new Error('引擎正在分析其他局面'));
    return new Promise((resolve, reject) => {
      this.pending = { resolve: (move) => { this.pending = null; resolve(move); }, reject, lines: new Map() };
      this.worker.postMessage({ type: 'command', command: `setoption name MultiPV value ${multiPv}` });
      this.worker.postMessage({ type: 'command', command: `position fen ${boardToFen(board, side)}` });
      this.worker.postMessage({ type: 'command', command: `go depth ${depth}` });
    });
  }

  stop() {
    if (this.pending) this.worker?.postMessage({ type: 'command', command: 'stop' });
  }

  close() {
    this.stop();
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
    this.pending = null;
  }
}
