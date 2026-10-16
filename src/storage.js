const DB_NAME = 'chuhe-xiangqi-v1';
const STORE_NAME = 'records';
const STATE_STORE = 'state';

let serverStorage;
async function importedRecordsApi() {
  if (serverStorage !== undefined) return serverStorage;
  try {
    const response = await fetch('/api/imported-records', { cache: 'no-store' });
    serverStorage = response.ok;
  } catch { serverStorage = false; }
  return serverStorage;
}

async function serverRecords() {
  if (!await importedRecordsApi()) return [];
  const response = await fetch('/api/imported-records', { cache: 'no-store' });
  if (!response.ok) throw new Error('无法读取项目棋谱文件夹');
  return await response.json();
}

async function saveServerRecords(records) {
  if (!await importedRecordsApi()) return;
  const response = await fetch('/api/imported-records', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(records) });
  if (!response.ok) throw new Error('无法保存到项目棋谱文件夹');
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) return reject(new Error('当前浏览器不支持 IndexedDB'));
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      if (!request.result.objectStoreNames.contains(STATE_STORE)) request.result.createObjectStore(STATE_STORE, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const recordRepository = {
  async projectStorageAvailable() { return await importedRecordsApi(); },
  async all() {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME).objectStore(STORE_NAME).getAll();
      request.onsuccess = async () => {
        try {
          const merged = new Map(request.result.map((record) => [record.id, record]));
          for (const record of await serverRecords()) merged.set(record.id, record);
          resolve([...merged.values()]);
        } catch (error) { reject(error); }
      };
      request.onerror = () => reject(request.error);
    });
  },
  async put(record) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(record);
      transaction.oncomplete = async () => { try { await saveServerRecords([record]); resolve(); } catch (error) { reject(error); } };
      transaction.onerror = () => reject(transaction.error);
    });
  },
  async putMany(records) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      records.forEach((record) => store.put(record));
      transaction.oncomplete = async () => { try { await saveServerRecords(records); resolve(); } catch (error) { reject(error); } };
      transaction.onerror = () => reject(transaction.error);
    });
  },
  async delete(id) {
    const db = await openDatabase();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).delete(id);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    if (await importedRecordsApi()) {
      const response = await fetch(`/api/imported-records/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('无法从项目棋谱文件夹删除棋谱');
    }
  },
  async clear() {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  },
  async clearAll() {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME, STATE_STORE], 'readwrite');
      transaction.objectStore(STORE_NAME).clear();
      transaction.objectStore(STATE_STORE).clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    if (await importedRecordsApi()) {
      const response = await fetch('/api/imported-records', { method: 'DELETE' });
      if (!response.ok) throw new Error('无法清除项目棋谱文件夹中的数据');
    }
  },
  async getState(key) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STATE_STORE).objectStore(STATE_STORE).get(key);
      request.onsuccess = () => resolve(request.result?.value);
      request.onerror = () => reject(request.error);
    });
  },
  async putState(key, value) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STATE_STORE, 'readwrite');
      transaction.objectStore(STATE_STORE).put({ key, value });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  },
};

export async function loadSettings() { return await recordRepository.getState('settings') ?? {}; }
export async function saveSettings(settings) { return recordRepository.putState('settings', settings); }
