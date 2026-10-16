import { BLACK, RED, applyMove, fileOf, gameStatus, initialBoard, isInCheck, kindOf, legalMoves, otherSide, pieceThreatStatus, rankOf, sameMove, sideOf, toICCS, validateAndReplay } from './rules.js';
import { chooseLocalMoveAsync, requestSuggestion } from './ai.js';
import { loadSettings, recordRepository, saveSettings } from './storage.js';
import { chineseNotation } from './notation.js';
import { adjudicateRepetition } from './repetition.js';
import { playMoveSound } from './audio.js';
import { convertTextToRecord, extractText, findExistingImportedRecord, importXqfFolderFiles, MAX_IMPORT_SIZE } from './importer.js';
import { parseXqf, xqfMovesAsText } from './xqf.js';
import { cblMovesAsText, parseCbl } from './cbl.js';

const categories = ['古谱', '现代对局', '开局', '残局'];
const labels = { K: '帥', A: '仕', E: '相', R: '車', H: '馬', C: '炮', P: '兵', k: '將', a: '士', e: '象', r: '車', h: '馬', c: '炮', p: '卒' };
const names = { red: '红方', black: '黑方' };
const $ = (selector) => document.querySelector(selector);
const state = {
  view: 'study', records: [], builtinRecords: [], currentRecord: null, studyPly: 0, studyFlipped: false, selectedCategory: '', query: '', timer: null,
  expandedRecordGroups: new Set(), board: initialBoard(), side: RED, history: [], playFlipped: false, gameOver: false, adjudication: null, settings: {}, aiBusy: false,
};
let moveAudio;

function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove('show'), 3200);
}

function unlockMoveAudio() {
  const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
  if (!AudioContextClass) return;
  try { moveAudio ??= new AudioContextClass(); } catch { return; }
  if (moveAudio.state === 'suspended') moveAudio.resume().catch(() => {});
}

function mapSquare(square, flipped) {
  return flipped ? { file: 8 - fileOf(square), rank: 9 - rankOf(square) } : { file: fileOf(square), rank: rankOf(square) };
}
function point(file, rank) { return { x: 35 + file * 53.75, y: 40 + rank * (470 / 9) }; }
function svgElement(name, attributes = {}) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}

function renderBoard(svg, board, flipped, onSquare, selected = null, hints = [], lastMove = null, threatened = new Map()) {
  svg.replaceChildren();
  const prefix = svg.id;
  const defs = svgElement('defs');
  defs.innerHTML = `<linearGradient id="${prefix}-wood" x2="0" y2="1"><stop stop-color="#dbb77c"/><stop offset=".48" stop-color="#cba36a"/><stop offset="1" stop-color="#d9b77f"/></linearGradient><radialGradient id="${prefix}-red-face" cx="30%" cy="17%" r="86%"><stop stop-color="#fffdf4"/><stop offset=".48" stop-color="#f8e8ca"/><stop offset=".78" stop-color="#d9ae70"/><stop offset="1" stop-color="#a66d37"/></radialGradient><radialGradient id="${prefix}-black-face" cx="30%" cy="17%" r="86%"><stop stop-color="#fffdf4"/><stop offset=".48" stop-color="#f8e8ca"/><stop offset=".78" stop-color="#d9ae70"/><stop offset="1" stop-color="#a66d37"/></radialGradient><linearGradient id="${prefix}-gold-rim" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff9dc"/><stop offset=".22" stop-color="#f4d995"/><stop offset=".48" stop-color="#c18b49"/><stop offset=".68" stop-color="#fff0c0"/><stop offset=".88" stop-color="#9a632f"/><stop offset="1" stop-color="#f1d08a"/></linearGradient><linearGradient id="${prefix}-piece-side" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#e7c580"/><stop offset=".34" stop-color="#b47a3d"/><stop offset="1" stop-color="#714522"/></linearGradient><filter id="${prefix}-piece-shadow" x="-50%" y="-50%" width="210%" height="230%"><feGaussianBlur in="SourceAlpha" stdDeviation="3.5"/><feOffset dy="4"/><feComponentTransfer><feFuncA type="linear" slope=".48"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter><filter id="${prefix}-threat-glow" x="-70%" y="-70%" width="240%" height="240%"><feGaussianBlur stdDeviation="2.6" result="blur"/><feFlood flood-color="#e34b35" flood-opacity=".78"/><feComposite in2="blur" operator="in"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
  svg.append(defs);
  svg.append(svgElement('rect', { x: 0, y: 0, width: 500, height: 550, rx: 8, class: 'board-background', fill: `url(#${prefix}-wood)` }));
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
  svg.append(svgElement('rect', { x: 36, y: 263, width: 428, height: 28, class: 'board-river-band' }));
  const leftRiver = svgElement('text', { x: 104, y: 284, class: 'board-river', 'text-anchor': 'middle' }); leftRiver.textContent = '楚 河'; svg.append(leftRiver);
  const rightRiver = svgElement('text', { x: 396, y: 284, class: 'board-river', 'text-anchor': 'middle' }); rightRiver.textContent = '漢 界'; svg.append(rightRiver);
  svg.append(svgElement('rect', { x: 190, y: 267, width: 120, height: 20, rx: 10, class: 'board-brand-pill' }));
  const brandText = svgElement('text', { x: 250, y: 282, class: 'board-brand', 'text-anchor': 'middle' }); brandText.textContent = '楚河漢界'; svg.append(brandText);
  const redDigits = '一二三四五六七八九';
  const topSide = flipped ? RED : BLACK;
  const bottomSide = otherSide(topSide);
  for (let file = 0; file < 9; file += 1) {
    const boardFile = flipped ? 8 - file : file;
    const topLabel = svgElement('text', { x: point(file, 0).x, y: 29, class: `board-coordinate ${topSide}`, 'text-anchor': 'middle', 'aria-hidden': 'true' });
    topLabel.textContent = topSide === BLACK ? String(boardFile + 1) : redDigits[boardFile];
    svg.append(topLabel);
    const bottomLabel = svgElement('text', { x: point(file, 0).x, y: 536, class: `board-coordinate ${bottomSide}`, 'text-anchor': 'middle', 'aria-hidden': 'true' });
    bottomLabel.textContent = bottomSide === BLACK ? String(9 - boardFile) : redDigits[8 - boardFile];
    svg.append(bottomLabel);
  }
  for (let square = 0; square < 90; square += 1) {
    const { file, rank } = mapSquare(square, flipped); const { x, y } = point(file, rank);
    if (hints.some((move) => move.to === square)) svg.append(svgElement('circle', { cx: x, cy: y, r: 7, class: 'legal-dot' }));
    const piece = board[square];
    const threatStatus = threatened.get(square);
    if (piece) {
      const side = sideOf(piece);
      if (threatStatus) svg.append(svgElement('circle', { cx: x, cy: y, r: 25, class: `threat-ring ${threatStatus}` }));
      svg.append(svgElement('circle', { cx: x, cy: y + 5, r: 25, class: 'piece-shadow', filter: `url(#${prefix}-piece-shadow)` }));
      svg.append(svgElement('circle', { cx: x, cy: y + 3.2, r: 23, class: 'piece-side', fill: `url(#${prefix}-piece-side)` }));
      svg.append(svgElement('circle', { cx: x, cy: y, r: 23, class: `piece-rim ${side}`, fill: `url(#${prefix}-gold-rim)` }));
      svg.append(svgElement('circle', { cx: x, cy: y - 0.7, r: 20.6, class: `piece-disc ${side}`, fill: `url(#${prefix}-${side}-face)` }));
      svg.append(svgElement('circle', { cx: x, cy: y - 0.7, r: 17.9, class: `piece-inset ${side}` }));
      const text = svgElement('text', { x, y: y + 0.2, class: `piece-label ${side}` }); text.textContent = labels[piece]; svg.append(text);
      svg.append(svgElement('path', { d: `M ${x - 12} ${y - 15} Q ${x - 5} ${y - 21} ${x + 5} ${y - 18}`, class: `piece-glint ${side}` }));
    }
    if (square === selected) svg.append(svgElement('circle', { cx: x, cy: y, r: 25, fill: 'none', stroke: '#40805d', 'stroke-width': 1.8, 'pointer-events': 'none' }));
    if (lastMove?.from === square) {
      svg.append(svgElement('circle', { cx: x, cy: y, r: 8, class: 'last-move-origin-ring' }));
      svg.append(svgElement('circle', { cx: x, cy: y, r: 3.5, class: 'last-move-origin' }));
    }
    if (lastMove?.to === square) svg.append(svgElement('circle', { cx: x, cy: y, r: 25, class: 'last-move-destination' }));
    const threatDescription = threatStatus === 'protected' ? '，受到己方保护' : threatStatus === 'exposed' ? '，无保护且可能被吃' : '';
    const hit = svgElement('rect', { x: x - 26, y: y - 26, width: 52, height: 52, class: 'board-hit', tabindex: '0', role: 'gridcell', 'aria-label': `${toICCS(square)}${piece ? ` ${labels[piece]}${threatDescription}` : ''}` });
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
    const row = document.createElement('div'); row.className = 'move-row';
    const number = document.createElement('span'); number.className = 'move-number'; number.textContent = `${Math.floor(index / 2) + 1}.`;
    row.append(number);
    for (const ply of [index + 1, index + 2]) {
      if (ply > moves.length) continue;
      const move = moves[ply - 1]; const side = ply % 2 ? state.currentRecord.initialSide ?? RED : otherSide(state.currentRecord.initialSide ?? RED);
      const button = document.createElement('button'); button.className = `move-item ${side}${state.studyPly === ply ? ' active' : ''}`;
      button.textContent = chineseNotation(state.currentRecord.positions[ply - 1], move, side);
      button.setAttribute('aria-label', `第 ${ply} 着，${button.textContent}`);
      button.onclick = () => { stopPlayback(); state.studyPly = ply; renderStudyBoard(); };
      row.append(button);
    }
    container.append(row);
  }
}

function filteredRecords() {
  return state.records.filter((record) => !state.selectedCategory || record.category.includes(state.selectedCategory));
}

function recordGroup(record) {
  if (!record.userImported || !record.source?.name) return null;
  const sourceName = record.source.name.replaceAll('\\', '/');
  const basename = sourceName.split('/').at(-1);
  const extension = basename.match(/\.([^.]+)$/)?.[1]?.toLocaleLowerCase();
  if (extension === 'cbl') return { key: `cbl:${sourceName.toLocaleLowerCase()}`, name: basename.replace(/\.[^.]+$/, '') };
  if (extension === 'xqf' && sourceName.includes('/')) {
    const folderName = sourceName.split('/').at(-2);
    return { key: `xqf:${sourceName.slice(0, sourceName.lastIndexOf('/')).toLocaleLowerCase()}`, name: folderName };
  }
  return null;
}

function libraryEntries() {
  const query = state.query.trim().toLocaleLowerCase();
  const filtered = filteredRecords();
  const groups = new Map();
  for (const record of filtered) {
    const group = recordGroup(record);
    if (!group) continue;
    const entry = groups.get(group.key) ?? { ...group, records: [] };
    entry.records.push(record);
    groups.set(group.key, entry);
  }
  const recordMatches = (record) => !query || `${record.title} ${record.players?.red ?? ''} ${record.players?.black ?? ''} ${(record.tags ?? []).join(' ')}`.toLocaleLowerCase().includes(query);
  const groupedIds = new Set();
  const entries = [];
  for (const group of groups.values()) {
    const groupMatches = !query || group.name.toLocaleLowerCase().includes(query);
    if (group.records.length < 2 || (!groupMatches && !group.records.some(recordMatches))) continue;
    const records = groupMatches ? group.records : group.records.filter(recordMatches);
    if (records.length < 2 && !groupMatches) continue;
    records.forEach((record) => groupedIds.add(record.id));
    entries.push({ type: 'folder', ...group, records, total: group.records.length });
  }
  for (const record of filtered) {
    if (groupedIds.has(record.id) || !recordMatches(record)) continue;
    entries.push({ type: 'record', record });
  }
  return entries;
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
  const entries = libraryEntries();
  $('#empty-library').hidden = state.records.length > 0;
  const renderRecord = (record, parent = list) => {
    const card = document.createElement('div'); card.className = `game-card${state.currentRecord?.id === record.id ? ' active' : ''}`;
    const select = document.createElement('button'); select.className = 'game-select';
    const title = document.createElement('strong'); title.textContent = record.title;
    const detail = document.createElement('span'); detail.textContent = `${record.category.join(' · ')}　${record.players?.red ?? '红方'} / ${record.players?.black ?? '黑方'}`;
    select.append(title, detail); select.onclick = () => loadRecord(record); card.append(select);
    if (record.userImported) {
      const remove = document.createElement('button'); remove.className = 'delete-record'; remove.type = 'button'; remove.textContent = '删除';
      remove.setAttribute('aria-label', `删除棋谱：${record.title}`);
      remove.onclick = async () => {
        if (!window.confirm(`确定删除棋谱“${record.title}”吗？`)) return;
        try {
          await recordRepository.delete(record.id);
          if (state.currentRecord?.id === record.id) { stopPlayback(); state.currentRecord = null; state.studyPly = 0; renderStudyBoard(); }
          await refreshRecords(); toast(`已删除棋谱：${record.title}`);
        } catch (error) { toast(`删除失败：${error.message}`); }
      };
      card.append(remove);
    }
    parent.append(card);
  };
  for (const entry of entries) {
    if (entry.type === 'record') { renderRecord(entry.record); continue; }
    const folder = document.createElement('section'); folder.className = 'game-folder';
    const key = entry.key;
    const expanded = state.expandedRecordGroups.has(key);
    const toggle = document.createElement('button'); toggle.className = 'game-folder-toggle'; toggle.type = 'button';
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.setAttribute('aria-label', `${expanded ? '收起' : '展开'}棋谱集：${entry.name}，${entry.total} 局`);
    const heading = document.createElement('strong'); heading.textContent = entry.name;
    const count = document.createElement('span'); count.className = 'game-folder-count'; count.textContent = `${entry.total} 局`;
    const chevron = document.createElement('span'); chevron.className = 'game-folder-chevron'; chevron.textContent = expanded ? '⌄' : '›';
    toggle.append(heading, count, chevron);
    toggle.onclick = () => { expanded ? state.expandedRecordGroups.delete(key) : state.expandedRecordGroups.add(key); renderLibrary(); };
    folder.append(toggle);
    if (expanded) {
      const children = document.createElement('div'); children.className = 'game-folder-records';
      for (const record of entry.records) renderRecord(record, children);
      folder.append(children);
    }
    list.append(folder);
  }
  if (!entries.length && state.records.length) { const empty = document.createElement('div'); empty.className = 'move-empty'; empty.textContent = '没有匹配的棋谱'; list.append(empty); }
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
  const nextPly = Math.max(0, Math.min(state.currentRecord.moves.length, state.studyPly + delta));
  if (delta > 0 && nextPly > state.studyPly) {
    const move = state.currentRecord.moves[nextPly - 1];
  playMoveSound(moveAudio, Boolean(state.currentRecord.positions[state.studyPly][move.to]));
  }
  state.studyPly = nextPly;
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
    $('#storage-status').textContent = await recordRepository.projectStorageAvailable() ? '棋谱保存在项目 data/imported 文件夹及此浏览器' : '棋谱保存在此浏览器';
  } catch (error) {
    state.records = [];
    $('#storage-status').textContent = '本地存储不可用';
    toast(error.message);
  }
  renderLibrary();
}

async function importJsonFile(file) {
  if (!file) return;
  if (file.size > MAX_IMPORT_SIZE) { toast('文件超过 500 MiB 上限'); return; }
  try {
    const data = JSON.parse(await file.text());
    const backup = data?.format === 'chuhe-backup/v1';
    const records = backup ? data.records : Array.isArray(data) ? data : [data];
    if (!Array.isArray(records)) throw new Error('备份文件缺少棋谱数组');
    const ids = new Set(state.records.map((record) => record.id));
    let overwritten = 0;
    const validated = records.map((record) => {
      const normalized = validateAndReplay(record);
      if (ids.has(normalized.id)) overwritten += 1;
      ids.add(normalized.id);
      return { ...record, userImported: true };
    });
    await recordRepository.putMany(validated);
    if (backup && data.game) await recordRepository.putState('active-game', data.game);
    if (backup && data.settings) { state.settings = { ...state.settings, apiUrl: data.settings.apiUrl ?? '', model: data.settings.model ?? '' }; await saveSettings(state.settings); }
    await refreshRecords();
    $('#import-file').value = '';
    if (validated.length === 1) loadRecord(validated[0]);
    toast(`成功导入 ${validated.length} 盘棋谱，覆盖 ${overwritten} 盘`);
  } catch (error) { toast(`导入失败：${error.message}`); }
}

async function importXqfFolder(files) {
  const input = $('#import-folder');
  const status = $('#folder-import-status');
  const selectedFiles = Array.from(files);
  const xqfCount = selectedFiles.filter((file) => /\.(xqf|cbl)$/i.test(file.name)).length;
  input.disabled = true;
  status.hidden = false;
  status.title = '';
  if (!xqfCount) {
    status.textContent = '所选文件夹及子文件夹中没有 .xqf 或 .cbl 棋谱。';
    input.value = '';
    input.disabled = false;
    return;
  }
  try {
    const result = await importXqfFolderFiles(selectedFiles, state.records, ({ current, total, sourceName }) => {
      status.title = sourceName;
      status.textContent = `正在校验 ${current}/${total}：${sourceName.split(/[\\/]/).at(-1)}`;
    });
    if (result.records.length) {
      await recordRepository.putMany(result.records);
      await refreshRecords();
    }
    const ignoredCount = selectedFiles.length - xqfCount;
    const summary = `批量导入完成：保存 ${result.records.length} 盘，其中覆盖 ${result.overwritten} 盘，失败 ${result.failures.length} 项${ignoredCount ? `，非 XQF/CBL 文件跳过 ${ignoredCount} 个` : ''}。`;
    const failureDetails = result.failures.slice(0, 3).map(({ sourceName, message }) => `${sourceName}：${message}`).join('；');
    status.textContent = failureDetails ? `${summary}失败示例：${failureDetails}${result.failures.length > 3 ? '；更多失败请检查文件后重试' : ''}` : summary;
    toast(summary);
  } catch (error) {
    status.textContent = `批量导入中止：${error.message}`;
    toast(`批量导入失败：${error.message}`);
  } finally {
    status.title = '';
    input.value = '';
    input.disabled = false;
  }
}

let pendingImportSource = '';
let pendingXqfMetadata = null;
async function importFile(file) {
  if (!file) return;
  if (file.size > MAX_IMPORT_SIZE) { toast('文件超过 500 MiB 上限'); $('#import-file').value = ''; return; }
  if (file.name.toLowerCase().endsWith('.json')) return importJsonFile(file);
  if (file.name.toLowerCase().endsWith('.cbl')) {
    try {
      $('#import-status').textContent = '正在解析 CBL 多盘棋谱库…';
      const library = parseCbl(await file.arrayBuffer(), file.name);
      let overwritten = 0;
      const records = [];
      const failures = [];
      for (const game of library.records) {
        try {
          const record = convertTextToRecord(cblMovesAsText(game), { title: game.title, sourceName: file.name });
          const existing = findExistingImportedRecord(state.records, file.name, game.title);
          if (existing) overwritten += 1;
          records.push({ ...record, id: existing?.id ?? record.id, players: game.players, result: game.result, initialPosition: game.initialPosition, userImported: true });
        } catch (error) { failures.push(`${game.title}：${error.message}`); }
      }
      if (!records.length) throw new Error(failures.slice(0, 2).join('；') || '棋库中没有可校验棋谱');
      await recordRepository.putMany(records);
      await refreshRecords();
      toast(`CBL 棋谱库导入完成：保存 ${records.length} 盘，覆盖 ${overwritten} 盘，失败 ${failures.length} 盘`);
    } catch (error) { toast(`CBL 导入失败：${error.message}`); }
    finally { $('#import-file').value = ''; }
    return;
  }
  try {
    $('#import-status').textContent = '正在提取棋谱内容…';
    $('#import-text').value = '';
    $('#import-title').value = file.name.replace(/\.[^.]+$/, '');
    pendingImportSource = file.name;
    pendingXqfMetadata = null;
    $('#import-dialog').showModal();
    let text;
    if (file.name.toLowerCase().endsWith('.xqf')) {
      pendingXqfMetadata = parseXqf(await file.arrayBuffer(), file.name);
      text = xqfMovesAsText(pendingXqfMetadata);
      $('#import-title').value = pendingXqfMetadata.title;
      $('#import-status').textContent = `已解码 XQF 主线共 ${pendingXqfMetadata.moves.length} 着；请检查后逐着进行规则校验。`;
    } else {
      text = await extractText(file, (message) => { $('#import-status').textContent = message; });
    }
    $('#import-text').value = text;
    if (!pendingXqfMetadata) $('#import-status').textContent = '请检查识别文本；棋谱将逐着匹配并验证合法性。';
  } catch (error) {
    $('#import-dialog').close();
    toast(`读取失败：${error.message}`);
  } finally {
    $('#import-file').value = '';
  }
}

async function convertAndImport() {
  const button = $('#convert-import');
  button.disabled = true;
  try {
    $('#import-status').textContent = '正在逐着校验并转换棋谱…';
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const title = $('#import-title').value;
    const record = convertTextToRecord($('#import-text').value, { title, sourceName: pendingImportSource });
    const existing = findExistingImportedRecord(state.records, pendingImportSource, title);
    const normalized = { ...record, id: existing?.id ?? record.id, ...(pendingXqfMetadata ? { players: pendingXqfMetadata.players, result: pendingXqfMetadata.result } : {}), userImported: true };
    await recordRepository.put(normalized);
    await refreshRecords();
    loadRecord(normalized);
    $('#import-dialog').close();
    pendingXqfMetadata = null;
    toast(`已${existing ? '覆盖' : '导入'}棋谱，共 ${normalized.moves.length} 着`);
  } catch (error) {
    $('#import-status').textContent = error.message;
    toast(`转换失败：${error.message}`);
  } finally { button.disabled = false; }
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
  const payload = { board: state.board, side: state.side, history: state.history, gameOver: state.gameOver, adjudication: state.adjudication, mode: $('#mode-select').value, userSide: $('#side-select').value, strength: $('#strength-select').value };
  recordRepository.putState('active-game', payload).catch(() => {});
}

function renderPlayBoard() {
  const last = state.history.at(-1)?.move ?? null;
  const status = gameStatus(state.board, state.side);
  renderBoard($('#play-board'), state.board, state.playFlipped, onPlaySquare, state.selectedSquare ?? null, state.selectedSquare == null ? [] : legalMoves(state.board, state.side).filter((move) => move.from === state.selectedSquare), last, pieceThreatStatus(state.board));
  const endStatus = state.adjudication ?? status;
  const endReason = state.adjudication ? '长将判负' : status.reason;
  $('#turn-label').textContent = state.gameOver ? `${names[endStatus.winner]}胜 · ${endReason}` : `${names[state.side]}走棋${status.inCheck ? ' · 将军' : ''}`;
  $('#play-status').textContent = $('#turn-label').textContent;
  $('#undo-button').disabled = !state.history.length || state.aiBusy;
  $('#restart-button').disabled = state.aiBusy;
  $('#mode-select').disabled = state.aiBusy;
  $('#side-select').disabled = state.aiBusy;
  renderHistory();
}

function renderHistory() {
  const container = $('#play-history'); container.replaceChildren();
  if (!state.history.length) { const empty = document.createElement('span'); empty.className = 'move-empty'; empty.textContent = '棋局尚未开始'; container.append(empty); return; }
  state.history.forEach(({ move, captured, previousBoard, previousSide }, index) => {
    const item = document.createElement('span'); item.className = `history-ply ${previousSide}${index === state.history.length - 1 ? ' active' : ''}`;
    const number = document.createElement('strong'); number.textContent = `${Math.floor(index / 2) + 1}.`;
    const notation = document.createElement('span'); notation.textContent = `${chineseNotation(previousBoard, move, previousSide)}${captured ? ' ×' : ''}`;
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
  playMoveSound(moveAudio, Boolean(captured));
  const previousBoard = state.board;
  state.board = applyMove(state.board, move);
  state.history.push({ move, captured, previousBoard, previousSide: state.side });
  state.side = otherSide(state.side); state.selectedSquare = null;
  const status = gameStatus(state.board, state.side);
  const initialPosition = state.history[0];
  const trace = [{ key: `${initialPosition.previousBoard.map((piece) => piece ?? '.').join('')}:${initialPosition.previousSide}` }];
  for (const entry of state.history) {
    const nextBoard = applyMove(entry.previousBoard, entry.move);
    const nextSide = otherSide(entry.previousSide);
    trace.push({ key: `${nextBoard.map((piece) => piece ?? '.').join('')}:${nextSide}`, mover: entry.previousSide, gaveCheck: isInCheck(nextBoard, nextSide) });
  }
  state.adjudication = status.over ? null : adjudicateRepetition(trace);
  state.gameOver = status.over || Boolean(state.adjudication);
  renderPlayBoard(); saveGame();
  if (state.gameOver) { toast(`${names[state.adjudication?.winner ?? status.winner]}胜：${state.adjudication?.reason ?? status.reason}`); return; }
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
  state.gameOver = false; state.adjudication = null; state.selectedSquare = null; renderPlayBoard(); saveGame();
}

async function requestAdvice() {
  const button = $('#suggest-button'); button.disabled = true;
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const result = await requestSuggestion({ board: state.board, side: state.side, moves: legalMoves(state.board, state.side), settings: state.settings, strength: $('#strength-select').value, signal: controller.signal });
    $('#ai-output').textContent = `${names[state.side]}可考虑 ${chineseNotation(state.board, result.move, state.side)}。${result.explanation}`;
  } catch (error) { $('#ai-output').textContent = `暂时无法分析：${error.name === 'AbortError' ? '请求超时' : error.message}`; }
  finally { clearTimeout(timeout); button.disabled = false; }
}

function setView(view) {
  stopPlayback(); state.view = view;
  document.querySelectorAll('.nav-button').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  document.querySelectorAll('.view').forEach((node) => node.classList.toggle('active', node.id === `${view}-view`));
  $('#study-header-actions').hidden = view !== 'study';
  if (view === 'play') renderPlayBoard();
}

function bindEvents() {
  document.addEventListener('pointerdown', unlockMoveAudio);
  document.addEventListener('keydown', unlockMoveAudio);
  document.querySelectorAll('.nav-button').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
  $('#import-file').addEventListener('change', (event) => importFile(event.target.files[0]));
  $('#import-folder').addEventListener('change', (event) => importXqfFolder(event.target.files));
  $('#convert-import').addEventListener('click', convertAndImport);
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
    state.board = initialBoard(); state.side = RED; state.history = []; state.gameOver = false; state.adjudication = null; state.selectedSquare = null; renderPlayBoard(); saveGame();
    if ($('#mode-select').value === 'ai' && $('#side-select').value === 'black') scheduleAiMove();
  });
  $('#mode-select').addEventListener('change', () => { state.board = initialBoard(); state.side = RED; state.history = []; state.gameOver = false; state.adjudication = null; renderPlayBoard(); saveGame(); if ($('#mode-select').value === 'ai' && $('#side-select').value === 'black') scheduleAiMove(); });
  $('#strength-select').addEventListener('change', saveGame);
  $('#side-select').addEventListener('change', () => { if ($('#mode-select').value === 'ai') { state.board = initialBoard(); state.side = RED; state.history = []; state.gameOver = false; state.adjudication = null; renderPlayBoard(); saveGame(); if ($('#side-select').value === 'black') scheduleAiMove(); } });
  $('#suggest-button').addEventListener('click', requestAdvice);
  $('#settings-button').addEventListener('click', openSettings);
  $('#clear-key').addEventListener('click', async () => { state.settings = { ...state.settings, apiKey: '' }; await saveSettings(state.settings); $('#api-key').value = ''; toast('本机 API 密钥已清除'); });
  $('#clear-data').addEventListener('click', async () => {
    if (!confirm('这会删除此浏览器中的导入棋谱、对局和设置，且无法恢复。建议先导出备份。继续吗？')) return;
    await recordRepository.clearAll(); state.records = []; state.currentRecord = null; state.history = []; state.board = initialBoard(); state.side = RED; state.gameOver = false; state.adjudication = null; state.settings = {};
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
  $('#strength-select').value = 'max';
  bindEvents();
  try {
    const response = await fetch('./data/records/modern-games.json');
    if (response.ok) state.builtinRecords = await response.json();
  } catch { toast('内置棋谱暂时无法读取'); }
  try {
    state.settings = await loadSettings();
    const savedGame = await recordRepository.getState('active-game');
    if (savedGame?.board?.length === 90 && Array.isArray(savedGame.history)) {
      state.board = savedGame.board; state.side = savedGame.side; state.history = savedGame.history; state.gameOver = savedGame.gameOver; state.adjudication = savedGame.adjudication ?? null;
      $('#mode-select').value = savedGame.mode ?? 'local'; $('#side-select').value = savedGame.userSide ?? 'red'; $('#strength-select').value = savedGame.strength ?? 'max';
    }
  } catch { $('#storage-status').textContent = '本地存储不可用'; }
  await refreshRecords();
  renderStudyBoard(); renderPlayBoard();
  if ($('#mode-select').value === 'ai' && $('#side-select').value === 'black' && state.side === RED && !state.history.length) scheduleAiMove();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./service-worker.js').catch(() => {});
}

initialize();
