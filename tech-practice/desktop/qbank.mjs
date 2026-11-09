import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import Ajv2020 from 'ajv/dist/2020.js';
import { AppError, ensure, hash, safePath, strictJSON } from './util.mjs';

export function readZip(bytes, limit = 500 * 1024 * 1024, options = {}) {
  ensure(bytes.length <= 100 * 1024 * 1024, '压缩包超过 100 MiB', 'E_SIZE');
  let zip;
  try { zip = new AdmZip(bytes); } catch { throw new AppError('压缩包损坏或不是有效 ZIP', 'E_ZIP'); }
  const entries = zip.getEntries();
  ensure(entries.length <= 10000, '压缩包文件数量超出限制', 'E_SIZE');
  let total = 0;
  const names = new Set(), result = new Map();
  for (const entry of entries) {
    const name = entry.entryName;
    const checkName = entry.isDirectory ? name.replace(/\/$/, '') : name;
    ensure(safePath(checkName), '压缩包包含不安全路径：' + name, 'E_PATH');
    ensure(((entry.attr >>> 16) & 0xf000) !== 0xa000, '压缩包不得包含符号链接', 'E_PATH');
    const normalized = checkName.normalize('NFC').toLowerCase();
    ensure(!names.has(normalized), '压缩包路径重复或大小写冲突：' + name, 'E_PATH');
    names.add(normalized);
    total += entry.header.size;
    ensure(total <= limit && (entry.header.size <= 10 * 1024 * 1024 || name.startsWith('artifacts/') || options.backup && name === 'learning.sqlite'), '解压后文件超过限制', 'E_SIZE');
    ensure(entry.header.size < 1024 * 1024 || entry.header.size / Math.max(1, entry.header.compressedSize) <= (options.backup ? 10000 : 100), '压缩比异常', 'E_SIZE');
    if (!entry.isDirectory) {
      const content = entry.getData();
      ensure(content.length === entry.header.size, '压缩包文件长度不一致', 'E_ZIP');
      result.set(name, content);
    }
  }
  return result;
}

export class QBankValidator {
  constructor(schema) {
    this.schema = schema;
    this.validateSchema = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
  }
  fromText(text) { return this.validate(strictJSON(text)); }
  fromFile(file) {
    ensure(fs.statSync(file).size <= 100 * 1024 * 1024, '导入文件超过 100 MiB', 'E_SIZE');
    if (file.toLowerCase().endsWith('.zip')) {
      const entries = readZip(fs.readFileSync(file));
      ensure(entries.has('bank.json'), '题库包根目录缺少 bank.json', 'E_ZIP');
      const bank = strictJSON(entries.get('bank.json').toString('utf8'));
      return this.validate(bank, entries);
    }
    return this.fromText(fs.readFileSync(file, 'utf8'));
  }
  validate(input, assets = null) {
    const bank = structuredClone(input), errors = [], warnings = [];
    const issue = (code, message, jsonPath, questionId = null) => errors.push({ severity: 'error', code, message, json_path: jsonPath, question_id: questionId });
    if (!this.validateSchema(bank)) {
      const candidates = this.validateSchema.errors ?? [];
      const useful = candidates.filter(e => !['oneOf', 'const', 'required', 'additionalProperties'].includes(e.keyword));
      const missing = candidates.filter(e => ['required', 'additionalProperties'].includes(e.keyword) && !e.schemaPath.includes('/oneOf/'));
      const selected = [...useful, ...missing];
      for (const e of (selected.length ? selected : candidates).slice(0, 30)) issue('E_SCHEMA', e.message + (e.params.missingProperty ? `：${e.params.missingProperty}` : '') + (e.params.additionalProperty ? `：${e.params.additionalProperty}` : ''), '$' + e.instancePath);
      return { valid: false, errors, warnings, bank: null };
    }
    const unique = (items, key, where, qid) => {
      const seen = new Set();
      for (const item of items) {
        const value = key ? item[key] : item;
        if (seen.has(value)) issue('E_DUPLICATE_ID', 'ID 重复：' + value, where, qid);
        seen.add(value);
      }
      return seen;
    };
    ensure(bank.questions.length <= 10000, '单次题目数量超过 10000', 'E_SIZE');
    unique(bank.questions, 'id', '$.questions');
    const pointIds = unique(bank.knowledge_points, 'id', '$.knowledge_points');
    const pointMap = new Map(bank.knowledge_points.map(p => [p.id, p]));
    for (const p of bank.knowledge_points) {
      const seen = new Set([p.id]);
      let current = p;
      while (current?.parent_id) {
        if (!pointIds.has(current.parent_id)) { issue('E_KNOWLEDGE_REF', '父知识点不存在：' + current.parent_id, '$.knowledge_points'); break; }
        if (seen.has(current.parent_id)) { issue('E_KNOWLEDGE_CYCLE', '知识点先修层级形成循环', '$.knowledge_points'); break; }
        seen.add(current.parent_id); current = pointMap.get(current.parent_id);
      }
    }
    const normalizedPaths = new Set();
    for (const [name, file] of Object.entries(bank.files)) {
      if (!safePath(name)) issue('E_PATH', '不安全的文件名：' + name, '$.files');
      const normalized = name.normalize('NFC').toLowerCase();
      if (normalizedPaths.has(normalized)) issue('E_PATH_COLLISION', '文件名存在大小写或规范化冲突：' + name, '$.files');
      normalizedPaths.add(normalized);
      if (file.kind === 'asset') {
        if (!safePath(file.package_path) || !assets?.has(file.package_path)) issue('E_ASSET', '缺少包内附件：' + file.package_path, '$.files.' + name);
        else if (hash(assets.get(file.package_path)) !== file.sha256) issue('E_ASSET_HASH', '附件 SHA-256 不一致：' + name, '$.files.' + name);
        else {
          const bytes = assets.get(file.package_path);
          file._base64 = bytes.toString('base64');
          file._text = bytes.toString('utf8');
        }
      }
    }
    for (let index = 0; index < bank.questions.length; index++) {
      const q = bank.questions[index], base = '$.questions[' + index + ']';
      const err = (code, message, suffix = '') => issue(code, message, base + suffix, q.id);
      if (!q.knowledge_point_ids.every(id => pointIds.has(id))) err('E_KNOWLEDGE_REF', '题目引用了不存在的知识点');
      if (!q.knowledge_point_ids.includes(q.primary_knowledge_point_id)) err('E_PRIMARY_KNOWLEDGE', '主知识点必须属于本题知识点');
      if (q.answer?.options) {
        const ids = unique(q.answer.options, 'id', base + '.answer.options', q.id);
        const correct = q.type === 'single_choice' ? [q.answer.correct_option_id] : q.answer.correct_option_ids;
        if (!correct.every(id => ids.has(id))) err('E_OPTION_REF', '正确答案引用了不存在的选项', '.answer');
      }
      if (q.type === 'fill_blank') {
        const ids = [...unique(q.answer.blanks, 'id', base + '.answer.blanks', q.id)].sort();
        const placeholders = [...q.stem_md.matchAll(/\{\{([a-z][a-z0-9_-]*)\}\}/g)].map(x => x[1]).sort();
        if (JSON.stringify(ids) !== JSON.stringify(placeholders)) err('E_BLANK_REF', '填空占位符与 blanks 不一致');
      }
      if (q.type === 'short_answer') {
        unique(q.rubric.criteria, 'id', base + '.rubric.criteria', q.id);
        if (q.rubric.criteria.reduce((n, c) => n + c.points, 0) !== q.rubric.max_score) err('E_RUBRIC', '量表分值总和不等于 max_score');
      }
      if (q.execution) {
        const e = q.execution;
        for (const [field, role] of [['starter_files', 'starter'], ['reference_files', 'reference'], ['testbench_files', 'test']]) {
          const mappings = field === 'testbench_files' ? e.judge.testbench_files ?? [] : e[field];
          const targets = new Set();
          for (const m of mappings) {
            if (!safePath(m.source_path) || !safePath(m.target_path)) err('E_PATH', '文件映射包含不安全路径');
            const target = m.target_path.normalize('NFC').toLowerCase();
            if (targets.has(target)) err('E_MAPPING_COLLISION', '文件目标路径重复');
            targets.add(target);
            const file = bank.files[m.source_path];
            if (!file || file.role !== role) err('E_FILE_REF', '文件不存在或角色不匹配：' + m.source_path);
            if (file?.kind === 'asset' && (file._text?.includes('\u0000') || file._text?.includes('\ufffd'))) err('E_SOURCE_ENCODING', '代码文件必须是 UTF-8 文本');
          }
          if (field !== 'testbench_files' && !mappings.some(m => m.target_path === e.entry_file)) err('E_ENTRY', '入口文件不在 ' + field + ' 的目标路径中');
        }
        if (e.judge.kind === 'stdio') {
          unique(e.judge.tests, 'id', base + '.execution.judge.tests', q.id);
          if (!['sample', 'private'].every(v => e.judge.tests.some(t => t.visibility === v))) err('E_TESTS', '需要至少一个样例和一个正式测试用例');
        } else {
          for (const field of ['starter_files', 'reference_files']) {
            const targets = [...e[field], ...e.judge.testbench_files].map(m => m.target_path.normalize('NFC').toLowerCase());
            if (new Set(targets).size !== targets.length) err('E_MAPPING_COLLISION', '测试文件与程序文件目标路径冲突');
          }
        }
        if (!['python-stdio-1', 'c11-stdio-1', 'cpp17-stdio-1', 'iverilog-verilog-1'].includes(e.runtime_ref)) warnings.push({ question_id: q.id, message: '当前版本暂不支持环境 ' + e.runtime_ref });
      }
      if (['fill_blank', 'short_answer'].includes(q.type)) warnings.push({ question_id: q.id, message: '预留题型，仅支持阅读与笔记，暂不自动判分' });
    }
    return { valid: !errors.length, errors, warnings, bank: errors.length ? null : bank };
  }
}
export function questionHash(q, bank) {
  return hash({ question: q, files: questionFiles(q, bank) });
}
export function questionFiles(q, bank) {
  const refs = [...q.execution?.starter_files ?? [], ...q.execution?.reference_files ?? [], ...q.execution?.judge?.testbench_files ?? []];
  return { ...Object.fromEntries(Object.entries(bank.files).filter(([, f]) => f.role === 'asset')), ...Object.fromEntries(refs.map(m => [m.source_path, bank.files[m.source_path]])) };
}
export function exportBank(bank) {
  const clone = structuredClone(bank), zip = new AdmZip();
  for (const file of Object.values(clone.files)) if (file.kind === 'asset') {
    const data = Buffer.from(file._base64, 'base64');
    zip.addFile(file.package_path, data); delete file._base64; delete file._text;
  }
  if (Object.values(clone.files).some(f => f.kind === 'asset')) {
    zip.addFile('bank.json', Buffer.from(JSON.stringify(clone, null, 2), 'utf8'));
    return { bytes: zip.toBuffer(), extension: 'qbank.zip' };
  }
  return { bytes: Buffer.from(JSON.stringify(clone, null, 2), 'utf8'), extension: 'json' };
}
