import { BLACK, RED, applyMove, initialBoard, legalMoves, otherSide, parseFEN, sideOf, toICCS, validateAndReplay } from './rules.js';
import { chineseNotation } from './notation.js';
import { parseXqf, xqfMovesAsText } from './xqf.js';
import { cblMovesAsText, parseCbl } from './cbl.js';

export const MAX_IMPORT_SIZE = 500 * 1024 * 1024;
const tokenPattern = /[a-i][0-9][a-i][0-9]|(?:[前中后](?:车|車|马|馬|炮|兵|卒|帅|帥|将|將|相|象|仕|士)(?:进|進|退|平)[一二三四五六七八九1-9])|(?:(?:车|車|马|馬|炮|兵|卒|帅|帥|将|將|相|象|仕|士)[一二三四五六七八九1-9](?:进|進|退|平)[一二三四五六七八九1-9])/g;

const normalize = (value) => value.replaceAll('車', '车').replaceAll('馬', '马').replaceAll('帥', '帅').replaceAll('將', '将').replaceAll('進', '进');

export async function extractText(file, onProgress = () => {}) {
  if (!file) throw new Error('未选择文件');
  if (file.size > MAX_IMPORT_SIZE) throw new Error('文件超过 500 MiB 上限');
  const extension = file.name.split('.').at(-1).toLowerCase();
  if (extension === 'json') throw new Error('JSON 棋谱请使用 JSON 导入流程');
  if (extension === 'xqf') return xqfMovesAsText(parseXqf(await file.arrayBuffer(), file.name));
  if (extension === 'cbl') throw new Error('CBL 是多盘棋谱库，请直接导入以批量添加其中的棋谱');
  if (['txt', 'md', 'pgn', 'iccs', 'fen', 'cpx'].includes(extension)) return await file.text();
  if (extension === 'docx') {
    onProgress('正在读取 Word 文档…');
    const mammoth = await import('https://cdn.jsdelivr.net/npm/mammoth@1.9.0/+esm');
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return result.value;
  }
  if (extension === 'pdf') return await extractPdf(file, onProgress);
  if (['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tif', 'tiff'].includes(extension)) {
    onProgress('正在加载中文 OCR（首次使用需联网下载识别组件）…');
    const worker = await createOcrWorker(onProgress);
    try { return (await worker.recognize(file)).data.text; } finally { await worker.terminate(); }
  }
  if (extension === 'doc') throw new Error('不支持旧版 .doc 二进制格式，请先另存为 .docx 或 PDF');
  throw new Error(`暂不支持 .${extension} 格式；支持 JSON、TXT、MD、PGN、ICCS、FEN、DOCX、PDF 和常见图片`);
}

export async function importXqfFolderFiles(files, existingRecords = [], onProgress = () => {}) {
  const candidates = Array.from(files).filter((file) => /\.(xqf|cbl)$/i.test(file.name));
  const knownSources = new Set(existingRecords.filter((record) => record.userImported).map((record) => record.source?.name).filter(Boolean));
  const records = [];
  const failures = [];
  let duplicates = 0;
  for (let index = 0; index < candidates.length; index += 1) {
    const file = candidates[index];
    const sourceName = file.webkitRelativePath || file.name;
    onProgress({ current: index + 1, total: candidates.length, sourceName });
    if (knownSources.has(sourceName)) { duplicates += 1; continue; }
    try {
      if (index % 5 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      if (file.size > MAX_IMPORT_SIZE) throw new Error('文件超过 500 MiB 上限');
      if (file.name.toLowerCase().endsWith('.cbl')) {
        const library = parseCbl(await file.arrayBuffer(), sourceName);
        for (const parsed of library.records) {
          const record = convertTextToRecord(cblMovesAsText(parsed), { title: parsed.title, sourceName });
          records.push({ ...record, players: parsed.players, result: parsed.result, initialPosition: parsed.initialPosition, source: { ...record.source, name: sourceName }, userImported: true });
        }
      } else {
        const parsed = parseXqf(await file.arrayBuffer(), file.name);
        const record = convertTextToRecord(xqfMovesAsText(parsed), { title: parsed.title, sourceName });
        records.push({ ...record, players: parsed.players, result: parsed.result, source: { ...record.source, name: sourceName }, userImported: true });
      }
      knownSources.add(sourceName);
    } catch (error) {
      failures.push({ sourceName, message: error.message });
    }
  }
  return { records, failures, duplicates, total: candidates.length };
}

async function createOcrWorker(onProgress) {
  const { createWorker } = await import('https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/+esm');
  const worker = await createWorker('chi_sim+eng', 1, { logger: (message) => { if (message.status) onProgress(`中文 OCR：${message.status}${message.progress ? ` ${Math.round(message.progress * 100)}%` : ''}`); } });
  return worker;
}

async function extractPdf(file, onProgress) {
  onProgress('正在读取 PDF 文档…');
  const pdfjs = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  let worker;
  let currentPage = 0;
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      currentPage = pageNumber;
      onProgress(`正在提取 PDF 第 ${pageNumber}/${pdf.numPages} 页…`);
      const page = await pdf.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        const text = content.items.map((item) => item.str).join(' ');
        if (text.trim()) pages.push(text);
        else {
          const viewport = page.getViewport({ scale: 1.5 });
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
          await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
          worker ??= await createOcrWorker((message) => onProgress(`正在 OCR PDF 第 ${currentPage}/${pdf.numPages} 页：${message}`));
          pages.push((await worker.recognize(canvas)).data.text);
          canvas.width = 0;
          canvas.height = 0;
        }
      } finally {
        page.cleanup();
      }
    }
  } finally {
    await worker?.terminate();
    await pdf.destroy();
  }
  return pages.join('\n');
}

export function convertTextToRecord(text, { title, sourceName }) {
  const fenMatch = text.match(/((?:[rnbakcpRNBAKCP1-9]+\/){9}[rnbakcpRNBAKCP1-9]+\s+[wb](?:\s+\d+){0,2})/);
  const startingPosition = fenMatch ? parseFEN(fenMatch[1]) : { board: initialBoard(), side: RED };
  const moveText = fenMatch ? text.replace(fenMatch[0], '') : text;
  const tokens = [...moveText.matchAll(tokenPattern)].map((match) => match[0]);
  if (!tokens.length) throw new Error('没有识别到棋谱着法；可在文本框修正 OCR 结果后重试');
  let board = startingPosition.board;
  let side = startingPosition.side;
  const moves = [];
  for (const rawToken of tokens) {
    const legal = legalMoves(board, side);
    let move;
    if (/^[a-i][0-9][a-i][0-9]$/.test(rawToken)) {
      move = { from: (rawToken.charCodeAt(0) - 97) + Number(rawToken[1]) * 9, to: (rawToken.charCodeAt(2) - 97) + Number(rawToken[3]) * 9 };
    } else {
      const candidate = normalize(rawToken);
      move = legal.find((option) => normalize(chineseNotation(board, option, side)) === candidate);
    }
    if (!move || !legal.some((option) => option.from === move.from && option.to === move.to) || sideOf(board[move.from]) !== side) {
      throw new Error(`第 ${moves.length + 1} 着无法匹配合法着法：“${rawToken}”；请检查文本顺序、记谱或 OCR`);
    }
    moves.push({ from: toICCS(move.from), to: toICCS(move.to) });
    board = applyMove(board, move);
    side = otherSide(side);
  }
  const record = {
    schema: 'xiangqi-study/v1', id: `import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: title.trim() || sourceName.replace(/\.[^.]+$/, ''), category: ['现代对局'],
    players: { red: '红方', black: '黑方' }, result: '未完',
    source: { name: sourceName, rights: '用户导入；来源与使用许可待确认' },
    initialPosition: fenMatch ? { fen: fenMatch[1] } : 'standard', moves, annotations: {}, tags: ['导入转换'],
  };
  validateAndReplay(record);
  return record;
}
