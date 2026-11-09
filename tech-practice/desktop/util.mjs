import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseTree } from 'jsonc-parser';

export class AppError extends Error {
  constructor(message, code = 'INVALID_REQUEST', details = null) { super(message); this.code = code; this.details = details; }
}
export const ensure = (condition, message, code, details) => { if (!condition) throw new AppError(message, code, details); };
export const hash = value => crypto.createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value)).digest('hex');
export const uid = () => crypto.randomUUID();
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export function safePath(value) {
  if (typeof value !== 'string' || !value || value.length > 240 || /[\\:\x00-\x1f]/.test(value) || value.startsWith('/')) return false;
  return value.split('/').every(segment => segment && segment !== '.' && segment !== '..' && !/[. ]$/.test(segment)
    && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment));
}
export function within(root, relative) {
  ensure(safePath(relative), '不安全的文件路径：' + relative, 'E_PATH');
  const resolved = path.resolve(root, relative);
  ensure(resolved.startsWith(path.resolve(root) + path.sep), '文件路径超出工作目录', 'E_PATH');
  return resolved;
}
export function strictJSON(text, maxBytes = 12 * 1024 * 1024) {
  ensure(typeof text === 'string' && Buffer.byteLength(text, 'utf8') <= maxBytes, 'JSON 为空或超过 12 MiB 限制', 'E_SIZE');
  const errors = [];
  const tree = parseTree(text.replace(/^\uFEFF/, ''), errors, { disallowComments: true, allowTrailingComma: false });
  ensure(tree && !errors.length, `JSON 格式错误，位置 ${errors[0]?.offset ?? 0}。请去掉注释、尾逗号和代码围栏。`, 'E_JSON');
  const walk = node => {
    if (node.type === 'object') {
      const seen = new Set();
      for (const property of node.children ?? []) {
        const key = property.children[0].value;
        ensure(!seen.has(key), `JSON 存在重复字段：${key}，位置 ${property.offset}`, 'E_DUPLICATE_KEY');
        ensure(!['__proto__', 'prototype', 'constructor'].includes(key), `不允许使用保留字段 ${key}`, 'E_KEY');
        seen.add(key);
      }
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(tree);
  return JSON.parse(text.replace(/^\uFEFF/, ''));
}
export function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + uid() + '.tmp';
  try {
    const fd = fs.openSync(tmp, 'wx');
    try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
  } finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}
export function listFiles(root, prefix = '') {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const relative = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.isSymbolicLink()) throw new AppError('不接受符号链接', 'E_PATH');
    return entry.isDirectory() ? listFiles(path.join(root, entry.name), relative) : [relative];
  });
}
export function localDay(date = new Date(), timeZone = 'Asia/Shanghai') {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
export const identity = (bankId, questionId) => bankId + '/' + questionId;
export function cleanOutput(value) { return value.replace(/\r\n/g, '\n'); }
export function compareOutput(actual, expected, comparator) {
  const a = cleanOutput(actual), b = cleanOutput(expected);
  return comparator === 'exact' ? a === b : a.trimEnd() === b.trimEnd();
}
