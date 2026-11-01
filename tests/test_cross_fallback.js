// 跨源补位可能拿到酷我的无损链接，而酷我无损档偶发 410。
// 这里验证：首条候选失败时，播放链路能自动降级到下一条候选（320k mp3）。
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const errors = [];
const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/',
  beforeParse(window) {
    window.fetch = (...a) => fetch(...a);
    window.AbortController = AbortController;
    window.scrollTo = () => {};
    window.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
    window.HTMLMediaElement.prototype.pause = function () {};
    window.open = () => null;
    window.addEventListener('error', e => errors.push((e.error && e.error.stack) || e.message));
  }
});
const { window } = dom, doc = window.document;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
function check(n, c, x) { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (x ? '  -> ' + x : '')); c ? pass++ : fail++; }

async function totalSize(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, { headers: { Range: 'bytes=0-2047' }, redirect: 'follow', signal: ctrl.signal });
    const m = (r.headers.get('content-range') || '').match(/\/(\d+)\s*$/);
    return { status: r.status, total: m ? parseInt(m[1], 10) : 0 };
  } catch (e) { return { status: 0, total: 0, err: e.name }; }
  finally { clearTimeout(t); }
}

(async () => {
  await sleep(1500);
  const input = doc.getElementById('searchInput');
  input.value = '晴天';
  doc.getElementById('searchBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  let rows = [];
  for (let attempt = 0; attempt < 2 && !rows.length; attempt++) {
    if (attempt) {
      await sleep(3000);
      input.value = '晴天';
      doc.getElementById('searchBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    }
    for (let i = 0; i < 45; i++) {
      await sleep(1000);
      rows = [...doc.querySelectorAll('#resultList .track-row')];
      if (rows.length) break;
    }
  }
  const dot = r => { const d = r.querySelector('.t-tags .pill .dot'); return d ? d.className.replace('dot ', '') : '?'; };
  const qqRow = rows.find(function (r) {
    return dot(r) === 'qq' && /晴天/.test(r.querySelector('.t-name').textContent);
  });
  check('找到 QQ 的「晴天」', !!qqRow, qqRow ? qqRow.querySelector('.t-name').textContent.trim() : '无');

  qqRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  let first = '';
  for (let i = 0; i < 45; i++) {
    await sleep(1000);
    first = doc.getElementById('audio').src || '';
    if (first) break;
  }
  check('已设置播放链接', !!first, first.slice(0, 100));

  const p1 = await totalSize(first);
  if (p1.status === 410) {
    console.log('       首条候选确实是酷我无损 410，触发降级');
  } else {
    console.log('       首条候选 HTTP ' + p1.status + ' ' + (p1.total / 1048576).toFixed(2) + ' MB');
  }

  /* 连续模拟加载失败，走完整的候选链。
     候选顺序是「可播档优先 + 无损兜底 + 各自的 http 副本」，所以中间几步
     可能撞上酷我偶发的无损 410 —— 真实浏览器会继续往下试，这里也一路试到底。 */
  const audio = doc.getElementById('audio');
  let cur = first, steps = [];
  for (let i = 0; i < 5; i++) {
    const p = await totalSize(cur);
    steps.push((p.status || 'ERR') + '/' + (p.total / 1048576).toFixed(1) + 'MB');
    if (p.status === 206 || p.status === 200) {
      check('第 ' + (i + 1) + ' 条候选即可播', true, 'HTTP ' + p.status + ' ' + (p.total / 1048576).toFixed(2) + ' MB');
      check('降级链最终拿到完整版', p.total > 1048576, (p.total / 1048576).toFixed(2) + ' MB');
      console.log('       候选链: ' + steps.join(' → '));
      break;
    }
    audio.dispatchEvent(new window.Event('error', { bubbles: false }));
    await sleep(800);
    const next = audio.src || '';
    if (!next || next === cur) {
      check('失败后切换到下一条候选', false, '卡在 ' + cur.slice(0, 60));
      break;
    }
    cur = next;
  }

  console.log('\n运行期错误：' + (errors.length ? errors.join(' | ') : '(无)'));
  check('无未捕获异常', errors.length === 0, errors.length + ' 个');
  console.log('\n合计：' + pass + ' PASS / ' + fail + ' FAIL');
  if (fail) process.exitCode = 1;
})();
