// 本機 JSON 儲存：釘選的商品清單、每個商品最新的查詢結果、設定。
// 存在 data/store.json（已被 .gitignore 擋掉，不會上傳）。
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

const STORE_PATH = path.join(DATA_DIR, 'store.json');

const DEFAULT_STATE = {
  settings: {
    intervalMinutes: 30, // 每隔幾分鐘自動更新一次
  },
  items: [],   // [{ id, name, addedAt }]
  results: {}, // { [itemId]: { updatedAt, ok, error, listings, rawCount } }
};

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

let state = load();

function load() {
  ensureDir();
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_STATE,
      ...parsed,
      settings: { ...DEFAULT_STATE.settings, ...(parsed.settings || {}) },
    };
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

function persist() {
  ensureDir();
  fs.writeFileSync(STORE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

export function getState() {
  return state;
}

export function getSettings() {
  return state.settings;
}

export function updateSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  persist();
  return state.settings;
}

export function getItems() {
  return state.items;
}

export function addItem(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('商品名稱不能空白');
  const exists = state.items.find((i) => i.name === trimmed);
  if (exists) return exists;
  const item = { id: cryptoId(), name: trimmed, addedAt: Date.now() };
  state.items.push(item);
  persist();
  return item;
}

export function removeItem(id) {
  state.items = state.items.filter((i) => i.id !== id);
  delete state.results[id];
  persist();
}

export function setResult(itemId, result) {
  state.results[itemId] = { ...result, updatedAt: Date.now() };
  persist();
}

function cryptoId() {
  return 'it_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
