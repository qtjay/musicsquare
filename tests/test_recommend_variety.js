// 推荐多样性验证（真实浏览器 + 真实网络）
// 1) 隔天打开是否换一批   2) 连续「换一批」重叠率   3) 单批内是否有重复歌曲
const path = require('path');
const { chromium } = require('playwright');

const FILE = 'file:///' + path.join(__dirname, '..', 'index.html').replace(/\\/g, '/');
const REC_KEY = 'musicsquare-recommend-v1';

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('PASS ' + name + (extra ? ' | ' + extra : '')); }
  else { fail++; console.log('FAIL ' + name + (extra ? ' | ' + extra : '')); }
};

async function waitRec(page, timeoutMs = 40000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const n = await page.$$eval('#recommendList .track-row', els => els.length).catch(() => 0);
    if (n > 0) return n;
    await page.waitForTimeout(800);
  }
  return 0;
}

async function snapshot(page) {
  return await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#recommendList .track-row')];
    return {
      titles: rows.map(r => {
        const t = r.querySelector('.t-title') || r.querySelector('.t-name') || r;
        return (t.textContent || '').trim();
      }),
      sources: rows.map(r => {
        const d = r.querySelector('.dot');
        if (!d) return '?';
        return ['netease', 'qq', 'kuwo', 'joox'].find(s => d.classList.contains(s)) || '?';
      }),
      hint: (document.getElementById('recHint') || {}).textContent || '',
      stored: localStorage.getItem('musicsquare-recommend-v1')
    };
  });
}

const normT = s => String(s || '').toLowerCase().replace(/[\s　]+/g, '');
const overlap = (a, b) => {
  const sa = new Set(a.map(normT));
  let n = 0;
  b.forEach(x => { if (sa.has(normT(x))) n++; });
  return { n, pct: b.length ? Math.round(n / b.length * 100) : 0 };
};
const dupIn = (list) => {
  const m = new Map();
  list.forEach(x => m.set(normT(x), (m.get(normT(x)) || 0) + 1));
  return [...m.entries()].filter(([, c]) => c > 1).map(([t, c]) => t + '×' + c);
};
const srcStat = (srcs) => {
  const m = {};
  srcs.forEach(s => m[s] = (m[s] || 0) + 1);
  return m;
};

(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  // ---- 第 1 天：全新用户 ----
  await page.goto(FILE, { waitUntil: 'load' });
  await page.evaluate(k => localStorage.removeItem(k), REC_KEY);
  await page.reload({ waitUntil: 'load' });
  const n1 = await waitRec(page);
  const day1 = await snapshot(page);
  check('首次加载出推荐', n1 > 0, n1 + ' 条');
  console.log('  第1天关键词: ' + day1.hint);
  console.log('  第1天音源分布: ' + JSON.stringify(srcStat(day1.sources)));
  check('推荐覆盖多个音源', Object.keys(srcStat(day1.sources)).filter(k => k !== '?').length >= 2,
    JSON.stringify(srcStat(day1.sources)));
  const d1 = dupIn(day1.titles);
  check('单批内无重复歌曲', d1.length === 0, d1.length ? d1.slice(0, 5).join(', ') : '0 首重复');

  // ---- 第 2 天：把 ts 改成 2 天前，模拟隔天打开 ----
  await page.evaluate((k) => {
    const raw = localStorage.getItem(k);
    const j = raw ? JSON.parse(raw) : {};
    j.ts = Date.now() - 2 * 86400000;   // 距今 2 天
    localStorage.setItem(k, JSON.stringify(j));
  }, REC_KEY);
  await page.reload({ waitUntil: 'load' });
  await waitRec(page);
  const day2 = await snapshot(page);
  console.log('  第2天关键词: ' + day2.hint);
  check('隔天打开关键词已变化', day2.hint !== day1.hint, day1.hint + ' → ' + day2.hint);
  const ov12 = overlap(day1.titles, day2.titles);
  check('隔天曲目重叠 < 40%', ov12.pct < 40, '重叠 ' + ov12.n + '/' + day2.titles.length + ' (' + ov12.pct + '%)');
  const d2 = dupIn(day2.titles);
  check('第2天单批内无重复', d2.length === 0, d2.length ? d2.slice(0, 5).join(', ') : '0 首重复');

  // ---- 第 3 天 ----
  await page.evaluate((k) => {
    const j = JSON.parse(localStorage.getItem(k) || '{}');
    j.ts = Date.now() - 3 * 86400000;
    localStorage.setItem(k, JSON.stringify(j));
  }, REC_KEY);
  await page.reload({ waitUntil: 'load' });
  await waitRec(page);
  const day3 = await snapshot(page);
  console.log('  第3天关键词: ' + day3.hint);
  const ov23 = overlap(day2.titles, day3.titles);
  check('第3天与第2天重叠 < 40%', ov23.pct < 40, '重叠 ' + ov23.n + '/' + day3.titles.length + ' (' + ov23.pct + '%)');

  // ---- 同会话连续「换一批」 ----
  console.log('\n--- 连续换一批 ---');
  const batches = [day3.titles];
  const hints = [day3.hint];
  for (let i = 0; i < 3; i++) {
    await page.click('#refreshRecBtn');
    await page.waitForTimeout(500);
    // 等 loading 结束（列表重新渲染出内容）
    const t0 = Date.now();
    while (Date.now() - t0 < 30000) {
      const html = await page.$eval('#recommendList', el => el.innerHTML).catch(() => '');
      if (html && !/rec-loading/.test(html)) break;
      await page.waitForTimeout(500);
    }
    const s = await snapshot(page);
    batches.push(s.titles); hints.push(s.hint);
    console.log('  第' + (i + 4) + '批关键词: ' + s.hint + ' (' + s.titles.length + ' 条)');
  }
  let worst = 0, worstPair = '';
  for (let i = 1; i < batches.length; i++) {
    const o = overlap(batches[i - 1], batches[i]);
    if (o.pct > worst) { worst = o.pct; worstPair = '第' + (i + 3) + '批 vs 第' + (i + 2) + '批'; }
    const d = dupIn(batches[i]);
    check('第' + (i + 3) + '批单批内无重复', d.length === 0, d.length ? d.slice(0, 5).join(', ') : '0 首重复');
  }
  check('相邻批次重叠 < 40%', worst < 40, '最高 ' + worst + '% (' + worstPair + ')');
  check('连续 4 批关键词不完全相同', new Set(hints).size > 1, hints.join(' / '));

  check('推荐状态已持久化', !!day3.stored && /"seed"/.test(day3.stored));
  check('无未捕获异常', errors.length === 0, errors.slice(0, 2).join(' | '));

  console.log('\nPASS=' + pass + ' FAIL=' + fail);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
