import { chooseLocalMove } from './ai.js';

self.addEventListener('message', ({ data }) => {
  try {
    self.postMessage({ move: chooseLocalMove(data.board, data.side, data.strength) });
  } catch (error) {
    self.postMessage({ error: error.message || '本地 AI 搜索失败' });
  }
});
