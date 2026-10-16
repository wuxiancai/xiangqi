import { BLACK, RED, applyMove, fileOf, gameStatus, initialBoard, kindOf, legalMoves, otherSide, rankOf, sameMove, sideOf, toICCS, validateAndReplay } from './rules.js';
import { chooseLocalMoveAsync, requestSuggestion } from './ai.js';
import { loadSettings, recordRepository, saveSettings } from './storage.js';

const categories = ['古谱', '现代对局', '开局', '残局'];
const labels = { K: '帥', A: '仕', E: '相', R: '車', H: '馬', C: '炮', P: '兵', k: '將', a: '士', e: '象', r: '車', h: '馬', c: '炮', p: '卒' };
const names = { red: '红方', black: '黑方' };
const $ = (selector) => document.querySelector(selector);
const state = {
  view: 'study', records: [], builtinRecords: [], currentRecord: null, studyPly: 0, studyFlipped: false, selectedCategory: '', query: '', timer: null,
  board: initialBoard(), side: RED, history: [], playFlipped: false, gameOver: false, settings: {}, aiBusy: false,
};

function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove('show'), 3200);
}

function mapSquare(square, flipped) {
  return flipped ? { file: 8 - fileOf(square), rank: 9 - rankOf(square) } : { file: fileOf(square), rank: rankOf(square) };
}
function point(file, rank) { return { x: 42 + file * 46, y: 42 + rank * 46 }; }
function svgElement(name, attributes = {}) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}

function renderBoard(svg, board, flipped, onSquare, selected = null, hints = [], lastMove = null) {
  svg.replaceChildren();
  svg.append(svgElement('rect', { x: 0, y: 0, width: 450, height: 500, class: 'board-background' }));
  const lines = svgElement('g', { class: 'board-lines' });
  for (let rank = 0; rank < 10; rank += 1) {
    const start = point(0, rank); const end = point(8, rank);
    lines.append(svgElement('line', { x1: start.x, y1: start.y, x2: end.x, y2: end.y, class: 'board-line' }));
  }
  for (let file = 0; file < 9; file += 1) {
    const top = point(file, 0); const bottom = point(file, 9);
    if (file === 0 || file === 8) lines.append(svgElement('line', { x1: top.x, y1: top.y, x2: bottom.x, y2: bottom.y, class: 'board-line' }));
    else {
      const riverTop = point(file, 4); const riverBottom = point(file, 5);
      lines.append(svgElement('line', { x1: top.x, y1: top.y, x2: riverTop.x, y2: riverTop.y, class: 'board-line' }));
      lines.append(svgElement('line', { x1: riverBottom.x, y1: riverBottom.y, x2: bottom.x, y2: bottom.y, class: 'board-line' }));
    }
  }
  for (const [file, fromRank, toRank] of [[3, 0, 2], [5, 0, 2], [3, 7, 9], [5, 7, 9]]) {
    const a = point(file, fromRank); const b = point(8 - file, toRank);
    lines.append(svgElement('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'board-line' }));
  }
  svg.append(lines);
  const riverText = svgElement('text', { x: 225, y: 274, class: 'board-river', 'text-anchor': 'middle' }); riverText.textContent = '楚 河　漢 界'; svg.append(riverText);
  for (let square = 0; square < 90; square += 1) {
    const { file, rank } = mapSquare(square, flipped); const { x, y } = point(file, rank);
    if (lastMove && (square === lastMove.from || square === lastMove.to)) svg.append(svgElement('circle', { cx: x, cy: y, r: 21, class: 'last-move' }));
    if (hints.some((move) => move.to === square)) svg.append(svgElement('circle', { cx: x, cy: y, r: 7, class: 'legal-dot' }));
    const piece = board[square];
    if (piece) {
      svg.append(svgElement('circle', { cx: x + 1, cy: y + 2, r: 19.5, class: 'piece-shadow' }));
      svg.append(svgElement('circle', { cx: x, cy: y, r: 19, class: `piece-disc ${sideOf(piece)}` }));
      const text = svgElement('text', { x, y: y + 1, class: `piece-label ${sideOf(piece)}` }); text.textContent = labels[piece]; svg.append(text);
    }
    if (square === selected) svg.append(svgElement('circle', { cx: x, cy: y, r: 22, fill: 'none', stroke: '#40805d', 'stroke-width': 2.5, 'pointer-events': 'none' }));
    const hit = svgElement('rect', { x: x - 22, y: y - 22, width: 44, height: 44, class: 'board-hit', tabindex: '0', role: 'gridcell', 'aria-label': `${toICCS(square)}${piece ? ` ${labels[piece]}` : ''}` });
    hit.dataset.square = String(square); svg.append(hit);
  }
  svg.onclick = (event) => { const target = event.target.closest('[data-square]'); if (target) onSquare(Number(target.dataset.square)); };
  svg.onkeydown = (event) => { const target = event.target.closest('[data-square]'); if (target && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onSquare(Number(target.dataset.square)); } };
}

function renderStudyBoard() {
  const board = state.currentRecord?.positions[state.studyPly] ?? initialBoard();
  const previous = state.studyPly ? state.currentRecord.moves[state.studyPly - 1] : null;
  renderBoard($('#study-board'), board, state.studyFlipped, () => {}, null, [], previous);
  const record = state.currentRecord;
  const initialSide = record?.initialSide ?? RED;
  const nextSide = state.studyPly % 2 ? otherSide(initialSide) : initialSide;
  $('#study-status').textContent = record ? `${record.title} · ${state.studyPly ? names[nextSide] + '行棋' : '开局'}` : '选择一盘棋谱开始';
  $('#move-counter').textContent = record ? `${state.studyPly} / ${record.moves.length} 着` : '—';
  $('#progress-fill').style.width = record?.moves.length ? `${state.studyPly / record.moves.length * 100}%` : '0%';
  $('#move-result').textContent = record?.result ?? '—';
  const annotation = record?.annotations?.[String(state.studyPly)];
  const last = state.studyPly ? record?.moves[state.studyPly - 1] : null;
  const currentBoard = board;
  const lastCapture = last && currentBoard[last.to];
  const checked = state.studyPly && gameStatus(currentBoard, nextSide).inCheck;
  const autoExplanation = checked ? '将军，迫使对方应将。' : lastCapture ? '吃子，争取子力优势。' : '';
  $('#annotation').lastElementChild.textContent = !record ? '选中棋谱后，这里会显示关键着法说明。' : annotation || autoExplanation || (state.studyPly ? '暂无解说' : '选中着法后显示关键着法说明。');
  renderMoveList();
}

function renderMoveList() {
  const container = $('#move-list'); container.replaceChildren();
  if (!state.currentRecord) { const empty = document.createElement('div'); empty.className = 'move-empty'; empty.textContent = '着法将显示在这里'; container.append(empty); return; }
  const { moves } = state.currentRecord;
  for (let index = 0; index < moves.length; index += 2) {
    const number = document.createElement('span'); number.className = 'move-number'; number.textContent = `${Math.floor(index / 2) + 1}.`;
    container.append(number);
    for (const ply of [index + 1, index + 2]) {
      if (ply > moves.length) { const spacer = document.createElement('span'); container.append(spacer); continue; }
      const move = moves[ply - 1]; const side = ply % 2 ? state.currentRecord.initialSide ?? RED : otherSide(state.currentRecord.initialSide ?? RED);
      const button = document.createElement('button'); button.className = `move-item${state.studyPly === ply ? ' active' : ''}`;
      button.textContent = `${side === RED ? '红' : '黑'} ${toICCS(move.from)}-${toICCS(move.to)}`;
      button.setAttribute('aria-label', `第 ${ply} 着，${button.textContent}`);
      button.onclick = () => { stopPlayback(); state.studyPly = ply; renderStudyBoard(); };
      container.append(button);
    }
  }
}

function filteredRecords() {
  const query = state.query.trim().toLocaleLowerCase();
  return state.records.filter((record) => (!state.selectedCategory || record.category.includes(state.selectedCategory)) && (!query || `${record.title} ${record.players?.red ?? ''} ${record.players?.black ?? ''} ${(record.tags ?? []).join(' ')}`.toLocaleLowerCase().includes(query)));
}

function renderLibrary() {
  $('#library-count').textContent = `${state.records.length} 盘`;
  const filters = $('#category-filters'); filters.replaceChildren();
  for (const category of ['', ...categories]) {
    const button = document.createElement('button'); button.className = `filter-chip${state.selectedCategory === category ? ' active' : ''}`; button.textContent = category || '全部';
    button.onclick = () => { state.selectedCategory = category; renderLibrary(); };
    filters.append(button);
  }
  const list = $('#game-list'); list.replaceChildren();
  const records = filteredRecords();
  $('#empty-library').hidden = state.records.length > 0;
  for (const record of records) {
    const button = document.createElement('button'); button.className = `game-card${state.currentRecord?.id === record.id ? ' active' : ''}`;
    const title = document.createElement('strong'); title.textContent = record.title;
    const detail = document.createElement('span'); detail.textContent = `${record.category.join(' · ')}　${record.players?.red ?? '红方'} / ${record.players?.black ?? '黑方'}`;
    button.append(title, detail); button.onclick = () => loadRecord(record);
    list.append(button);
  }
  if (!records.length && state.records.length) { const empty = document.createElement('div'); empty.className = 'move-empty'; empty.textContent = '没有匹配的棋谱'; list.append(empty); }
}

function loadRecord(raw) {
  stopPlayback();
  try {
    state.currentRecord = validateAndReplay(raw);
    state.studyPly = 0;
    $('#players-label').textContent = `${state.currentRecord.players?.red ?? '红方'} · ${state.currentRecord.players?.black ?? '黑方'}`;
    $('#study-source').textContent = `来源：${state.currentRecord.source.name ?? '未命名'} · 授权：${state.currentRecord.source.rights}`;
    renderLibrary(); renderStudyBoard();
  } catch (error) { toast(`棋谱无效：${error.message}`); }
}

function stopPlayback() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null; $('#study-play').textContent = '▶'; $('#study-play').setAttribute('aria-label', '自动播放');
}
function stepStudy(delta) {
  if (!state.currentRecord) return;
  state.studyPly = Math.max(0, Math.min(state.currentRecord.moves.length, state.studyPly + delta));
  if (state.studyPly === state.currentRecord.moves.length) stopPlayback();
  renderStudyBoard();
}
function togglePlayback() {
  if (!state.currentRecord) { toast('请先选择一盘棋谱'); return; }
  if (state.timer) { stopPlayback(); return; }
  if (state.studyPly >= state.currentRecord.moves.length) state.studyPly = 0;
  const delay = Number($('#study-speed').value);
  state.timer = setInterval(() => stepStudy(1), delay);
  $('#study-play').textContent = 'Ⅱ'; $('#study-play').setAttribute('aria-label', '暂停自动播放');
  stepStudy(1);
}

async function refreshRecords() {
  try {
    const imported = await recordRepository.all();
    const importedRecords = imported.map((record) => {
      const { positions, ...stored } = record;
      return stored;
    });
    state.records = [...state.builtinRecords, ...importedRecords.filter((record) => !state.builtinRecords.some((builtin) => builtin.id === record.id))];
    $('#storage-status').textContent = '棋谱保存在此浏览器';
  } catch (error) {
    state.records = [];
    $('#storage-status').textContent = '本地存储不可用';
    toast(error.message);
  }
  renderLibrary();
}

async function importFile(file) {
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { toast('文件超过 2 MiB 上限'); return; }
  try {
    const data = JSON.parse(await file.text());
    const backup = data?.format === 'chuhe-backup/v1';
    const records = backup ? data.records : Array.isArray(data) ? data : [data];
    if (!Array.isArray(records)) throw new Error('备份文件缺少棋谱数组');
    const ids = new Set(state.records.map((record) => record.id));
    const validated = records.map((record) => {
      const normalized = validateAndReplay(record);
      if (ids.has(normalized.id)) throw new Error(`棋谱 ID 已存在：${normalized.id}`);
      ids.add(normalized.id);
      return { ...record, userImported: true };
    });
    await recordRepository.putMany(validated);
    if (backup && data.game) await recordRepository.putState('active-game', data.game);
    if (backup && data.settings) { state.settings = { ...state.settings, apiUrl: data.settings.apiUrl ?? '', model: data.settings.model ?? '' }; await saveSettings(state.settings); }
    await refreshRecords();
    $('#import-file').value = '';
    if (validated.length === 1) loadRecord(validated[0]);
    toast(`成功导入 ${validated.length} 盘棋谱`);
  } catch (error) { toast(`导入失败：${error.message}`); }
}

function downloadJson(value, filename) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
}
async function exportRecords() {
  const records = state.records.filter((record) => record.userImported);
  const game = await recordRepository.getState('active-game');
  const settings = await loadSettings();
  if (!records.length && !game) { toast('当前没有可导出的本机数据'); return; }
  const cleanRecords = records.map(({ userImported, ...record }) => record);
  downloadJson({ format: 'chuhe-backup/v1', exportedAt: new Date().toISOString(), records: cleanRecords, game: game ?? null, settings: { apiUrl: settings.apiUrl ?? '', model: settings.model ?? '' } }, 'chuhe-backup-v1.json');
}

function saveGame() {
  const payload = { board: state.board, side: state.side, history: state.history, gameOver: state.gameOver, mode: $('#mode-select').value, userSide: $('#side-select').value };
  recordRepository.putState('active-game', payload).catch(() => {});
}

function renderPlayBoard() {
  const last = state.history.at(-1)?.move ?? null;
  const status = gameStatus(state.board, state.side);
  renderBoard($('#play-board'), state.board, state.playFlipped, onPlaySquare, state.selectedSquare ?? null, state.selectedSquare == null ? [] : legalMoves(state.board, state.side).filter((move) => move.from === state.selectedSquare), last);
  $('#turn-label').textContent = state.gameOver ? `${names[status.winner]}胜 · ${status.reason}` : `${names[state.side]}走棋${status.inCheck ? ' · 将军' : ''}`;
  $('#play-status').textContent = state.gameOver ? `${names[status.winner]}胜 · ${status.reason}` : `${names[state.side]}走棋${status.inCheck ? ' · 将军' : ''}`;
  $('#undo-button').disabled = !state.history.length || state.aiBusy;
  $('#restart-button').disabled = state.aiBusy;
  $('#mode-select').disabled = state.aiBusy;
  $('#side-select').disabled = state.aiBusy;
  renderHistory();
}

function renderHistory() {
  const container = $('#play-history'); container.replaceChildren();
  if (!state.history.length) { const empty = document.createElement('span'); empty.className = 'move-empty'; empty.textContent = '棋局尚未开始'; container.append(empty); return; }
  state.history.forEach(({ move, captured }, index) => {
    const item = document.createElement('span'); item.className = `history-ply${index === state.history.length - 1 ? ' active' : ''}`;
    const number = document.createElement('strong'); number.textContent = `${Math.floor(index / 2) + 1}${index % 2 ? '…' : '.'}`;
    const notation = document.createElement('span'); notation.textContent = `${toICCS(move.from)}-${toICCS(move.to)}${captured ? ' ×' : ''}`;
    item.append(number, notation); container.append(item);
  });
}

async function onPlaySquare(square) {
  if (state.gameOver || state.aiBusy) return;
  const mode = $('#mode-select').value; const userSide = $('#side-select').value;
  if (mode === 'ai' && state.side !== userSide) return;
  if (state.selectedSquare != null) {
    const move = legalMoves(state.board, state.side).find((candidate) => candidate.from === state.selectedSquare && candidate.to === square);
    if (move) { state.selectedSquare = null; await playMove(move); return; }
  }
  if (sideOf(state.board[square]) === state.side) state.selectedSquare = square;
  else state.selectedSquare = null;
  renderPlayBoard();
}

async function playMove(move) {
  const captured = state.board[move.to];
  const previousBoard = state.board;
  state.board = applyMove(state.board, move);
  state.history.push({ move, captured, previousBoard, previousSide: state.side });
  state.side = otherSide(state.side); state.selectedSquare = null;
  const status = gameStatus(state.board, state.side);
  state.gameOver = status.over;
  renderPlayBoard(); saveGame();
  if (status.over) { toast(`${names[status.winner]}胜：${status.reason}`); return; }
  const mode = $('#mode-select').value; const userSide = $('#side-select').value;
  if (mode === 'ai' && state.side !== userSide) await scheduleAiMove();
}

async function scheduleAiMove() {
  if (state.aiBusy || state.gameOver) return;
  state.aiBusy = true; renderPlayBoard();
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 20000);
  let move;
  try {
    const result = await requestSuggestion({ board: state.board, side: state.side, moves: legalMoves(state.board, state.side), settings: state.settings, strength: $('#strength-select').value, signal: controller.signal });
    move = result.move;
    if (result.provider === 'external') $('#ai-output').textContent = `AI 分析：${result.explanation}（外部模型建议，棋力未认证）`;
    else $('#ai-output').textContent = `AI 建议：${result.explanation}`;
  } catch (error) {
    if (state.settings.apiUrl && state.settings.apiKey && state.settings.model) {
      move = await chooseLocalMoveAsync(state.board, state.side, $('#strength-select').value);
      $('#ai-output').textContent = `AI 服务暂不可用，已降级到本地基础策略：${error.name === 'AbortError' ? '请求超时' : error.message}`;
    } else {
      $('#ai-output').textContent = `本地 AI 搜索失败：${error.message}`;
    }
  } finally { clearTimeout(timeout); }
  state.aiBusy = false;
  if (move && legalMoves(state.board, state.side).some((candidate) => sameMove(candidate, move))) await playMove(move);
  else { renderPlayBoard(); toast('AI 未能提供合法着法'); }
}

function undoMove() {
  if (!state.history.length || state.aiBusy) return;
  let count = 1;
  if ($('#mode-select').value === 'ai' && state.history.at(-1).previousSide !== $('#side-select').value && state.history.length > 1) count = 2;
  while (count-- && state.history.length) {
    const last = state.history.pop(); state.board = last.previousBoard; state.side = last.previousSide;
  }
  state.gameOver = false; state.selectedSquare = null; renderPlayBoard(); saveGame();
}

async function requestAdvice() {
  const button = $('#suggest-button'); button.disabled = true;
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const result = await requestSuggestion({ board: state.board, side: state.side, moves: legalMoves(state.board, state.side), settings: state.settings, strength: $('#strength-select').value, signal: controller.signal });
    $('#ai-output').textContent = `${names[state.side]}可考虑 ${toICCS(result.move.from)}-${toICCS(result.move.to)}。${result.explanation}`;
  } catch (error) { $('#ai-output').textContent = `暂时无法分析：${error.name === 'AbortError' ? '请求超时' : error.message}`; }
  finally { clearTimeout(timeout); button.disabled = false; }
}

function setView(view) {
  stopPlayback(); state.view = view;
  document.querySelectorAll('.nav-button').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  document.querySelectorAll('.view').forEach((node) => node.classList.toggle('active', node.id === `${view}-view`));
  if (view === 'play') renderPlayBoard();
}

function bindEvents() {
  document.querySelectorAll('.nav-button').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
  $('#import-file').addEventListener('change', (event) => importFile(event.target.files[0]));
  $('#search-input').addEventListener('input', (event) => { state.query = event.target.value; renderLibrary(); });
  $('#export-button').addEventListener('click', exportRecords);
  $('#study-first').addEventListener('click', () => { stopPlayback(); state.studyPly = 0; renderStudyBoard(); });
  $('#study-prev').addEventListener('click', () => { stopPlayback(); stepStudy(-1); });
  $('#study-next').addEventListener('click', () => { stopPlayback(); stepStudy(1); });
  $('#study-last').addEventListener('click', () => { stopPlayback(); if (state.currentRecord) state.studyPly = state.currentRecord.moves.length; renderStudyBoard(); });
  $('#study-play').addEventListener('click', togglePlayback);
  $('#study-speed').addEventListener('input', (event) => {
    const seconds = Number(event.target.value) / 1000; $('#speed-value').value = `${Number.isInteger(seconds) ? seconds : seconds.toFixed(2)} 秒`;
    if (state.timer) { stopPlayback(); togglePlayback(); }
  });
  $('#study-flip').addEventListener('click', () => { state.studyFlipped = !state.studyFlipped; renderStudyBoard(); });
  $('#play-flip').addEventListener('click', () => { state.playFlipped = !state.playFlipped; renderPlayBoard(); });
  $('#undo-button').addEventListener('click', undoMove);
  $('#restart-button').addEventListener('click', () => {
    state.board = initialBoard(); state.side = RED; state.history = []; state.gameOver = false; state.selectedSquare = null; renderPlayBoard(); saveGame();
    if ($('#mode-select').value === 'ai' && $('#side-select').value === 'black') scheduleAiMove();
  });
  $('#mode-select').addEventListener('change', () => { state.board = initialBoard(); state.side = RED; state.history = []; state.gameOver = false; renderPlayBoard(); saveGame(); if ($('#mode-select').value === 'ai' && $('#side-select').value === 'black') scheduleAiMove(); });
  $('#side-select').addEventListener('change', () => { if ($('#mode-select').value === 'ai') { state.board = initialBoard(); state.side = RED; state.history = []; state.gameOver = false; renderPlayBoard(); saveGame(); if ($('#side-select').value === 'black') scheduleAiMove(); } });
  $('#suggest-button').addEventListener('click', requestAdvice);
  $('#settings-button').addEventListener('click', openSettings);
  $('#clear-key').addEventListener('click', async () => { state.settings = { ...state.settings, apiKey: '' }; await saveSettings(state.settings); $('#api-key').value = ''; toast('本机 API 密钥已清除'); });
  $('#clear-data').addEventListener('click', async () => {
    if (!confirm('这会删除此浏览器中的导入棋谱、对局和设置，且无法恢复。建议先导出备份。继续吗？')) return;
    await recordRepository.clearAll(); state.records = []; state.currentRecord = null; state.history = []; state.board = initialBoard(); state.side = RED; state.gameOver = false; state.settings = {};
    renderLibrary(); renderStudyBoard(); renderPlayBoard(); $('#api-url').value = ''; $('#api-model').value = ''; $('#api-key').value = ''; toast('本机数据已清除');
  });
  $('#save-settings').addEventListener('click', async (event) => {
    event.preventDefault(); state.settings = { apiUrl: $('#api-url').value.trim(), model: $('#api-model').value.trim(), apiKey: $('#api-key').value.trim() };
    await saveSettings(state.settings); $('#settings-dialog').close(); toast('设置已保存在本机浏览器');
  });
}

function openSettings() {
  $('#api-url').value = state.settings.apiUrl ?? ''; $('#api-model').value = state.settings.model ?? ''; $('#api-key').value = state.settings.apiKey ?? '';
  $('#settings-dialog').showModal();
}

async function initialize() {
  bindEvents();
  try {
    const response = await fetch('./data/records/modern-games.json');
    if (response.ok) state.builtinRecords = await response.json();
  } catch { toast('内置棋谱暂时无法读取'); }
  try {
    state.settings = await loadSettings();
    const savedGame = await recordRepository.getState('active-game');
    if (savedGame?.board?.length === 90 && Array.isArray(savedGame.history)) {
      state.board = savedGame.board; state.side = savedGame.side; state.history = savedGame.history; state.gameOver = savedGame.gameOver;
      $('#mode-select').value = savedGame.mode ?? 'local'; $('#side-select').value = savedGame.userSide ?? 'red';
    }
  } catch { $('#storage-status').textContent = '本地存储不可用'; }
  await refreshRecords();
  renderStudyBoard(); renderPlayBoard();
  if ($('#mode-select').value === 'ai' && $('#side-select').value === 'black' && state.side === RED && !state.history.length) scheduleAiMove();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./service-worker.js').catch(() => {});
}

initialize();
