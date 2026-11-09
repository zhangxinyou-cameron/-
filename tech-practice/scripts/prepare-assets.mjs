import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const parent = path.dirname(root), out = path.join(root, 'assets'); fs.mkdirSync(out, { recursive: true });
for (const [from, to] of [
  ['题库协议与示例/qbank.schema.json', 'qbank.schema.json'], ['题库协议与示例/AI生成题库提示词.md', 'AI生成题库提示词.md'],
  ['题库协议与示例/examples/demo-bank.json', 'demo-bank.json']
]) {
  const source = path.join(parent, from), target = path.join(out, to);
  if (fs.existsSync(source)) fs.copyFileSync(source, target);
  else if (!fs.existsSync(target)) throw new Error('缺少题库协议资源：' + to);
}
fs.copyFileSync(path.join(root, 'node_modules/sql.js/dist/sql-wasm.wasm'), path.join(out, 'sql-wasm.wasm'));
const demo = JSON.parse(fs.readFileSync(path.join(out, 'demo-bank.json'), 'utf8'));
const makeBank = (id, title, description, selected) => ({ ...structuredClone(demo), bank_id: id, title, description,
  questions: structuredClone(demo.questions.filter(q => selected.includes(q.id))),
  files: Object.fromEntries(Object.entries(demo.files).filter(([p]) => id.includes('python') ? p.startsWith('python/') : p.startsWith('rtl/'))) });
const digital = makeBank('digital-ic-basics', '数字 IC 基础', '从 Verilog 语法、复位逻辑开始，动手写出第一个时序模块。', ['rtl_seq_assign', 'sync_reset_properties', 'verilog_assign_keyword', 'cdc_two_flop_limits', 'counter4_sync_reset']);
const python = makeBank('python-fundamentals', 'Python 编程入门', '理解语言基础与边界条件，用短小的程序检验自己的理解。', ['python_tuple_mutability', 'sum_all_integers']);
function q(id, type, title, domain, point, stem, explanation, extra, difficulty = 1) {
  return { id, revision: 1, type, title, domain, knowledge_point_ids: [point], primary_knowledge_point_id: point, difficulty,
    estimated_minutes: type === 'code' ? 8 : 2, stem_md: stem, explanation_md: explanation, hints: [],
    sources: [{ title: '原创入门练习', locator: '知习内置入门题库', note: '用于个人学习，欢迎在题库编辑器中补充和校订。' }], ...extra };
}
const opt = (id, text_md) => ({ id, text_md });
digital.questions.push(q('counter_wrap', 'single_choice', '四位无符号计数器的回绕', 'digital_ic', 'reset_basics',
  '4 位无符号寄存器的值为 4\'b1111。在加一并截断回 4 位后，结果是什么？', '4 位只能保存低 4 位。15 + 1 = 16，其低 4 位为 0000。',
  { answer: { options: [opt('opt_a', "4'b0000"), opt('opt_b', "4'b1111"), opt('opt_c', "4'b0001")], correct_option_id: 'opt_a' } }));
digital.questions.push(q('combinational_latch', 'true_false', '组合过程中的默认赋值', 'digital_ic', 'verilog_basics',
  '判断：希望描述纯组合逻辑时，某输出在部分路径完全没有赋值，可能会推断出保持旧值的锁存器。', '正确。组合输出应覆盖所有执行路径；需要保持状态时应明确使用适当的时序结构。', { answer: { correct: true } }));
python.questions.push(q('python_range_end', 'single_choice', 'range 的结束位置', 'programming', 'python_basics',
  '表达式 list(range(1, 4)) 的结果是什么？', 'range 包含起点、不包含终点，因此是 [1, 2, 3]。',
  { answer: { options: [opt('opt_a', '[1, 2, 3]'), opt('opt_b', '[1, 2, 3, 4]'), opt('opt_c', '[0, 1, 2, 3]')], correct_option_id: 'opt_a' } }));
python.questions.push(q('python_list_alias', 'single_choice', '列表引用与原地修改', 'programming', 'python_basics',
  '执行以下代码后，a 的值是什么？\n\n```python\na = [1, 2]\nb = a\nb.append(3)\n```', 'a 与 b 引用同一个列表，append 原地修改该列表，所以 a 也变为 [1, 2, 3]。',
  { answer: { options: [opt('opt_a', '[1, 2]'), opt('opt_b', '[1, 2, 3]'), opt('opt_c', '执行时抛出异常')], correct_option_id: 'opt_b' } }));
python.questions.push(q('python_empty_sum', 'true_false', '空序列求和', 'programming', 'python_basics',
  '判断：Python 中 sum([]) 的默认结果是整数 0。', '正确。sum 的默认起始值是 0，空可迭代对象没有其他加数。', { answer: { correct: true } }));
const systems = { ...structuredClone(demo), bank_id: 'c-cpp-foundations', title: 'C 与 C++ 基础', description: '练习类型、指针、数组与标准输入输出，建立扎实的系统编程基础。',
  knowledge_points: [{ id: 'c_types', name: '类型与指针' }, { id: 'cpp_io', name: 'C/C++ 输入输出' }], files: {}, questions: [] };
systems.questions.push(q('c_array_index', 'single_choice', '数组下标从哪里开始', 'programming', 'c_types',
  '声明 int a[4] 后，访问第一个元素应使用哪个表达式？', 'C/C++ 数组下标从 0 开始，合法元素下标为 0、1、2、3。a[4] 超出范围。',
  { answer: { options: [opt('opt_a', 'a[0]'), opt('opt_b', 'a[1]'), opt('opt_c', 'a[4]')], correct_option_id: 'opt_a' } }));
systems.questions.push(q('c_pointer_dereference', 'true_false', '解引用有效指针', 'programming', 'c_types',
  '判断：执行 int x = 3; int *p = &x; *p = 8; 后，x 的值为 8。', '正确。p 指向 x，对 *p 的赋值修改了 x 所在的对象。', { answer: { correct: true } }));
const limits = structuredClone(demo.questions.find(q => q.type === 'code').execution.limits);
for (const [kind, runtime, extension, reference, starter] of [
  ['cpp', 'cpp17-stdio-1', 'cpp', '#include <iostream>\nint main() { long long a, b; if (std::cin >> a >> b) std::cout << a + b << "\\n"; return 0; }\n', '#include <iostream>\n\nint main() {\n    // Read two integers and print their sum.\n    return 0;\n}\n'],
  ['c', 'c11-stdio-1', 'c', '#include <stdio.h>\nint main(void) { long long a, b; if (scanf("%lld%lld", &a, &b) == 2) printf("%lld\\n", a + b); return 0; }\n', '#include <stdio.h>\n\nint main(void) {\n    // Read two integers and print their sum.\n    return 0;\n}\n']
]) {
  const source = `${kind}/starter/main.${extension}`, solution = `${kind}/reference/main.${extension}`;
  systems.files[source] = { kind: 'inline', role: 'starter', content: starter };
  systems.files[solution] = { kind: 'inline', role: 'reference', content: reference };
  systems.questions.push(q(kind + '_sum_two', 'code', (kind === 'cpp' ? 'C++' : 'C') + ' 两数之和', 'programming', 'cpp_io',
    '读取两个绝对值不超过 10^9 的整数，输出它们的和。输入保证包含两个合法整数，以空白分隔。\n\n样例输入：`2 5`\n\n样例输出：`7`。',
    '使用足够宽的整数类型读取两个数后相加。注意标准输出只包含结果，不输出输入提示。',
    { execution: { runtime_ref: runtime, entry_file: `main.${extension}`, starter_files: [{ source_path: source, target_path: `main.${extension}` }], reference_files: [{ source_path: solution, target_path: `main.${extension}` }], limits,
      judge: { kind: 'stdio', comparator: 'trim_end', tests: [{ id: 'sample_two', visibility: 'sample', stdin: '2 5\n', expected_stdout: '7\n' },
        { id: 'private_negative', visibility: 'private', stdin: '-7 3\n', expected_stdout: '-4\n' }, { id: 'private_zero', visibility: 'private', stdin: '0 0\n', expected_stdout: '0\n' },
        { id: 'private_max', visibility: 'private', stdin: '1000000000 1000000000\n', expected_stdout: '2000000000\n' }] } } }));
}
fs.writeFileSync(path.join(out, 'starter-banks.json'), JSON.stringify([digital, python, systems], null, 2));
console.log('Prepared 3 starter banks, ' + [digital, python, systems].reduce((n,b)=>n+b.questions.length,0) + ' questions.');
