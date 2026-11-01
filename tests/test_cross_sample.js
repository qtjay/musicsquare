// 抽样多首 QQ 付费曲目，量化「跨源补位」前后的结果
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

async function totalSize(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, { headers: { Range: 'bytes=0-2047', Referer: 'https://y.qq.com/' }, redirect: 'follow', signal: ctrl.signal });
    const m = (r.headers.get('content-range') || '').match(/\/(\d+)\s*$/);
    return { status: r.status, total: m ? parseInt(m[1], 10) : 0 };
  } catch (e) { return { status: 0, total: 0, err: e.name }; }
  finally { clearTimeout(t); }
}

/* 先记录「如果只用 QQ 自身链路」能拿到什么 */
async function qqOnly(event_kw, mid) {
  try {
    const tRes = await fetch('https://tang.api.s01s.cn/music_open_api.php?msg=' + encodeURIComponent(event_kw) + '&type=json&mid=' + encodeURIComponent(mid), { signal: AbortSignal.timeout(12000) });
    const d = await tRes.json();
    if (d && d.song_mid) {
      for (const k of ['hq', 'standard', 'sq', 'pq', 'fq', 'accom']) {
        const u = d['song_play_url_' + k];
        if (u) return { via: 'tang[' + k + ']', url: String(u).replace(/^http:/, 'https:') };
      }
      if (d.song_play_url) return { via: 'tang[裸]', url: String(d.song_play_url).replace(/^http:/, 'https:') };
    }
  } catch (e) { /* tang 失败，继续看 vkeys */ }
  try {
    const v = await fetch('https://api.vkeys.cn/v2/music/tencent?mid=' + encodeURIComponent(mid), { signal: AbortSignal.timeout(8000) });
    const b = await v.json();
    if (b && b.code === 200 && b.data && b.data.url) return { via: 'vkeys', url: String(b.data.url).replace(/^http:/, 'https:') };
  } catch (e) { /* 两个都拿不到 */ }
  return { via: 'none', url: '' };
}

(async () => {
  await sleep(1500);
  console.log('搜索「周杰伦」，逐首比对「只走 QQ 自身链路」与「应用实际播放」的结果\n');

  const input = doc.getElementById('searchInput');
  input.value = '周杰伦';
  doc.getElementById('searchBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  let rows = [];
  for (let attempt = 0; attempt < 2 && !rows.length; attempt++) {
    if (attempt) {
      console.log('（首次检索无结果，重试）');
      await sleep(3000);
      input.value = '周杰伦';
      doc.getElementById('searchBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    }
    for (let i = 0; i < 45; i++) {
      await sleep(1000);
      rows = [...doc.querySelectorAll('#resultList .track-row')];
      if (rows.length) break;
    }
  }
  console.log('      结果总数 ' + rows.length);
  const dot = r => { const d = r.querySelector('.t-tags .pill .dot'); return d ? d.className.replace('dot ', '') : '?'; };
  const qqRows = rows.filter(r => dot(r) === 'qq').slice(0, 5);
  console.log('取前 ' + qqRows.length + ' 条 QQ 结果\n');

  let improved = 0, unchanged = 0;
  let prevSrc = doc.getElementById('audio').src || '';
  for (const row of qqRows) {
    const name = row.querySelector('.t-name').textContent.trim();
    row.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    // 必须等 src「发生变化」，否则读到的还是上一首残留的地址
    let src = '';
    for (let i = 0; i < 45; i++) {
      await sleep(1000);
      src = doc.getElementById('audio').src || '';
      if (src && src !== prevSrc) break;
    }
    prevSrc = src;
    // 标签要在 src 更新后再等一小会儿，renderNowPlaying 才能刷完
    await sleep(1200);
    const tags = (doc.getElementById('npTags').textContent || '').replace(/\s+/g, ' ').trim();
    const p = src ? await totalSize(src) : { status: 0, total: 0 };
    const mb = (p.total / 1048576).toFixed(2);
    const preview = /RS0\d/i.test(src) || p.total === 960887;
    console.log('  ' + name);
    console.log('     应用实际播放 → ' + mb + ' MB  ' + (preview ? '【仍是 60s 试听】' : '【完整版】') + '  ' + tags);
    preview ? unchanged++ : improved++;
  }

  console.log('\n合计：完整版 ' + improved + ' 首 / 试听 ' + unchanged + ' 首');
  console.log('运行期错误：' + (errors.length ? errors.join(' | ') : '(无)'));
  if (errors.length) process.exitCode = 1;
})();
