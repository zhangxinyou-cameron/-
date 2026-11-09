import fs from 'node:fs';
import path from 'node:path';
import { randomInt } from 'node:crypto';
import { atomicWrite } from './util.mjs';

// Original learning messages, stored locally and never fetched from a service.
export const startupQuotes = [
  '今天多懂一行，明天少绕一圈。',
  '把一个小问题想透，就是一次扎实的进步。',
  '每一次排错，都在加深你对系统的理解。',
  '暂时不会，是学习开始的地方。',
  '不必一次走很远，今天向前一步就好。',
  '让好奇心带路，让练习留下答案。',
  '真正属于你的知识，藏在亲手做过的细节里。',
  '慢一点想清楚，往往能更快走下去。',
  '今天认真解决的问题，会成为明天的底气。',
  '不用和别人比速度，和昨天的自己比理解。',
  '一个边界想明白，一份设计更可靠。',
  '把复杂的问题拆小，把今天的小事做好。',
  '每一个通过的测试，都来自之前认真找过的原因。',
  '从看懂到会做，中间的路值得亲自走一遍。',
  '遇到卡点时，回到最小的例子重新出发。',
  '答案可以参考，理解需要自己建立。',
  '持续的小进步，也能连成很长的路。',
  '把疑问记下来，你就在为突破准备入口。',
  '每一次重新尝试，都比原地等待多一种可能。',
  '今天的耐心，会成为下一次解决问题的从容。',
  '学会解释为什么，比记住结果走得更远。',
  '不急着证明自己，先认真弄懂眼前这一题。',
  '让每一段代码，都多一点清楚的思考。',
  '保持练习，也给理解留一点生长的时间。'
];

export function nextStartupQuote(root) {
  const file = path.join(root, 'startup-quotes.json');
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* First launch or invalid history. */ }
  const remaining = Array.isArray(saved.remaining) && saved.remaining.every(i => Number.isInteger(i) && i >= 0 && i < startupQuotes.length)
    && new Set(saved.remaining).size === saved.remaining.length ? [...saved.remaining] : [];
  if (!remaining.length) {
    remaining.push(...startupQuotes.map((_, i) => i));
    for (let i = remaining.length - 1; i > 0; i--) { const j = randomInt(i + 1); [remaining[i], remaining[j]] = [remaining[j], remaining[i]]; }
    if (remaining[0] === saved.last && remaining.length > 1) [remaining[0], remaining[1]] = [remaining[1], remaining[0]];
  }
  const index = remaining.shift();
  try { atomicWrite(file, JSON.stringify({ last: index, remaining })); } catch (error) { console.error('Startup quote history:', error.message); }
  return { id: index, text: startupQuotes[index] };
}
