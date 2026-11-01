// 验证两处音源修复：
//   1) isPreview 不再被无条件标记（按 quality / size / interval 判断）
//   2) QQ 付费曲目在 tang 无链接 + vkeys 只给试听时，跨源补位拿到完整直链
// 全部走真实网络 + 真实 DOM，不做任何 mock。
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HTML_PATH = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(HTML_PATH, 'utf8');
const errors = [];

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'https://example.com/',
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
const { window } = dom;
const doc = window.document;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
function check(name, cond, extra) {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  -> ' + extra : ''));
  cond ? pass++ : fail++;
}

async function totalSize(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, {
      headers: { Range: 'bytes=0-2047', Referer: 'https://y.qq.com/',
        'User-Agent': 'Mozilla/5.0' },
      redirect: 'follow', signal: ctrl.signal
    });
    const cr = r.headers.get('content-range') || '';
    const m = cr.match(/\/(\d+)\s*$/);
    // 服务端可能忽略 Range 直接返回 200，这时总大小只能从 Content-Length 读
    const cl = parseInt(r.headers.get('content-length') || '0', 10);
    return { status: r.status, total: m ? parseInt(m[1], 10) : cl };
  } catch (e) {
    return { status: 0, total: 0, err: e.name === 'AbortError' ? 'TIMEOUT' : e.message };
  } finally { clearTimeout(t); }
}

/* 从 index.html 里抽出被测的纯函数，注入页面上下文直接喂真实接口返回体 */
function extractFn(name) {
  const idx = html.indexOf('function ' + name + '(');
  if (idx < 0) throw new Error('找不到函数 ' + name);
  let depth = 0, started = false;
  for (let i = idx; i < html.length; i++) {
    const ch = html[i];
    if (ch === '{') { depth++; started = true; }
    else if (ch === '}') { depth--; if (started && depth === 0) return html.slice(idx, i + 1); }
  }
  throw new Error('函数 ' + name + ' 括号未闭合');
}

(async () => {
  await sleep(1500);

  /* ============ 一、isPreview 判据（喂真实接口返回体） ============ */
  console.log('--- 一、isPreview 判据 ---');
  window.eval(
    'const QQ_PREVIEW_BYTES = 960887;\n' +
    extractFn('isQQPreviewPayload') + '\n' +
    extractFn('normTitle') + '\n' +
    extractFn('normArtist') + '\n'
  );

  // 真实 mid：晴天 = 试听；孤勇者童声版 = 完整无损
  const realCases = [
    { label: '晴天（QQ付费，应为试听）', mid: '0039MnYb0qxYhV', expect: true },
    { label: '发如雪（QQ付费，应为试听）', mid: '0027oMO61wWi55', expect: true },
    { label: '孤勇者童声版（实际完整，不应标试听）', mid: '001dZQEk1GKV6U', expect: false }
  ];
  for (const c of realCases) {
    const r = await fetch('https://api.vkeys.cn/v2/music/tencent?mid=' + encodeURIComponent(c.mid));
    const b = await r.json();
    const d = (b && b.code === 200) ? b.data : null;
    if (!d) { check(c.label + ' 取到接口数据', false, 'code=' + (b && b.code)); continue; }
    const got = window.eval('isQQPreviewPayload')(d, d.url);
    check(c.label, got === c.expect,
      'quality=' + d.quality + ' size=' + d.size + ' interval=' + d.interval +
      ' → isPreview=' + got);
  }

  /* ============ 二、跨源补位：真实点播一首 QQ 付费歌 ============ */
  console.log('\n--- 二、跨源补位（真实搜索 → 点播 QQ 结果）---');
  // 必须精确到「原唱 + 歌名」：周杰伦原版的发如雪在 tang 上是付费、拿不到链接，
  // 才会走跨源补位。只搜"发如雪"会混进翻唱版（那些 tang 有链接，测不到补位）
  const input = doc.getElementById('searchInput');
  input.value = '发如雪 周杰伦';
  doc.getElementById('searchBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  let rows = [];
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    rows = [...doc.querySelectorAll('#resultList .track-row')];
    if (rows.length) break;
  }
  check('搜索返回结果', rows.length > 0, rows.length + ' 条');

  const sources = rows.map(r => {
    const dot = r.querySelector('.t-tags .pill .dot');
    return dot ? dot.className.replace('dot ', '') : '?';
  });
  const qqRows = rows.filter((r, i) => sources[i] === 'qq');
  check('QQ 音源有结果', qqRows.length > 0, JSON.stringify(sources.reduce((m, s) => (m[s] = (m[s] || 0) + 1, m), {})));

  if (!qqRows.length) {
    console.log('无 QQ 结果，终止');
    process.exitCode = 1;
    return;
  }

  // 挑「歌名=发如雪 且 歌手含周杰伦」的那一条，确保是 tang 拿不到链接的付费原版
  const want = qqRows.find(function (r) {
    const n = (r.querySelector('.t-name') || {}).textContent || '';
    const a = (r.querySelector('.t-artist') || {}).textContent || '';
    return /发如雪/.test(n) && /周杰伦/.test(a);
  });
  const row = want || qqRows[0];
  const targetTitle = row.querySelector('.t-name').textContent.trim();
  console.log('       目标 QQ 曲目: ' + targetTitle +
    (want ? '（精确命中原版）' : '（未精确命中，用第一条）'));
  row.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  let src = '';
  for (let i = 0; i < 40; i++) {
    await sleep(1000);
    src = doc.getElementById('audio').src || '';
    if (src) break;
  }
  check('拿到了播放链接', !!src, src.slice(0, 110));
  check('播放链接是 https', src.startsWith('https://'), src.slice(0, 8));
  check('播放链接不再是 QQ 试听片段', !/RS0\d/i.test(src) && src.indexOf('ws.stream.qqmusic.qq.com') < 0,
    src.indexOf('ws.stream.qqmusic.qq.com') >= 0 ? '仍是 vkeys 试听' : '已切换');

  const p = await totalSize(src);
  check('直链可以 Range 下载', p.status === 206 || p.status === 200, 'HTTP ' + p.status);
  check('总大小不是试听片段的 960887B', p.total !== 960887, p.total + ' bytes');
  check('总大小 > 1MB（判定为完整版）', p.total > 1048576, (p.total / 1048576).toFixed(2) + ' MB');

  const tags = (doc.getElementById('npTags').textContent || '').replace(/\s+/g, ' ').trim();
  console.log('       播放页标签: ' + tags);
  check('播放页标明了改用哪个音源', /版权受限，已改用/.test(tags), tags);
  check('不再显示「试听片段」', tags.indexOf('试听片段') < 0, tags);

  /* ---- 三、不得误伤：tang 能拿到完整版时不应触发跨源 ---- */
  console.log('\n--- 三、回归：免费 QQ 曲目不应被误标 ---');
  input.value = '孤勇者 童声版';
  doc.getElementById('searchBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  let rows2 = [];
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    rows2 = [...doc.querySelectorAll('#resultList .track-row')];
    if (rows2.length) break;
  }
  const src2 = rows2.map(r => {
    const dot = r.querySelector('.t-tags .pill .dot');
    return dot ? dot.className.replace('dot ', '') : '?';
  });
  const qq2 = rows2.filter((r, i) => src2[i] === 'qq');
  if (qq2.length) {
    const nm = qq2[0].querySelector('.t-name').textContent.trim();
    qq2[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    let s = '';
    for (let i = 0; i < 40; i++) {
      await sleep(1000);
      s = doc.getElementById('audio').src || '';
      if (s) break;
    }
    const tags2 = (doc.getElementById('npTags').textContent || '').replace(/\s+/g, ' ').trim();
    console.log('       ' + nm + ' → ' + tags2);
    check('完整版不被标记为试听片段', tags2.indexOf('试听片段') < 0, tags2);
    // 关键：既不能误标成试听，也不能放过一个确实被截断的 60 秒片段却不提示
    const p2 = s ? await totalSize(s) : { status: 0, total: 0 };
    check('实际拿到的直链足够长（>1MB）', p2.total > 1048576,
      (p2.total / 1048576).toFixed(2) + ' MB  HTTP ' + p2.status);
    check('没有退回到 960887 字节的试听片段', p2.total !== 960887, p2.total + ' bytes');
  } else {
    console.log('       （这次没搜到 QQ 结果，跳过）');
  }

  console.log('\n运行期错误：' + (errors.length ? errors.join(' | ') : '(无)'));
  check('无未捕获异常', errors.length === 0, errors.length + ' 个');

  console.log('\n合计：' + pass + ' PASS / ' + fail + ' FAIL');
  if (fail) process.exitCode = 1;
})();
