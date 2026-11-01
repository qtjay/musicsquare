// 酷我音源端到端：搜索 -> 播放 -> 候选降级 -> 歌词
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
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
    window.addEventListener('error', e => errors.push(e.error && e.error.stack || e.message));
  }
});
const { window } = dom;
const doc = window.document;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const check = (name, cond, extra) => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  -> ' + extra : ''));
  if (!cond) process.exitCode = 1;
};

async function downloadable(url) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    const r = await fetch(url, { headers: { Range: 'bytes=0-2047' }, signal: ctrl.signal });
    clearTimeout(t);
    const b = await r.arrayBuffer();
    return { ok: (r.status === 206 || r.ok) && b.byteLength > 0, status: r.status, bytes: b.byteLength };
  } catch (e) { return { ok: false, status: e.name, bytes: 0 }; }
}

(async () => {
  await sleep(1500);

  console.log('--- 搜索「周杰伦」（该歌手无损链接已知 410，用于验证降级）---');
  doc.getElementById('searchInput').value = '周杰伦';
  doc.getElementById('searchBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    if (doc.querySelectorAll('#resultList .track-row').length > 0) break;
  }
  const rows = [...doc.querySelectorAll('#resultList .track-row')];
  check('搜索返回结果', rows.length > 0, rows.length + ' 条');

  const kwRows = rows.filter(r => {
    const d = r.querySelector('.t-tags .pill .dot');
    return d && d.className.includes('kuwo');
  });
  check('酷我音源有结果', kwRows.length > 0, kwRows.length + ' 条');
  if (!kwRows.length) return;

  console.log('\n--- 点击第一条酷我结果 ---');
  const target = kwRows[0];
  console.log('       目标:', target.querySelector('.t-name').textContent);
  target.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  const audio = doc.getElementById('audio');
  for (let i = 0; i < 25; i++) { await sleep(1000); if (audio.src) break; }
  const first = audio.src;
  check('已拿到播放链接', !!first, first ? first.slice(0, 100) : '(空)');
  if (!first) return;
  check('链接为 https', first.startsWith('https://'), first.slice(0, 8));
  console.log('       播放器:', doc.getElementById('npName').textContent,
    '|', doc.getElementById('npTags').textContent.replace(/\s+/g, ' '));

  const d1 = await downloadable(first);
  console.log('       第一个候选下载:', d1.status, d1.bytes + 'B', d1.ok ? 'OK' : 'FAIL');

  console.log('\n--- 触发 error，验证候选队列降级 ---');
  audio.dispatchEvent(new window.Event('error'));
  await sleep(1200);
  const second = audio.src;
  check('降级后切换到了新链接', second && second !== first, second ? second.slice(0, 100) : '(未切换)');
  if (second && second !== first) {
    const d2 = await downloadable(second);
    console.log('       第二个候选下载:', d2.status, d2.bytes + 'B', d2.ok ? 'OK' : 'FAIL');
    check('降级链接可用', d2.ok, d2.status + ' / ' + d2.bytes + 'B');
  }

  console.log('\n--- 歌词验证（歌词为异步回填；部分歌曲接口本就无歌词，故逐首尝试）---');
  let lyricText = '';
  let lyricSong = '';
  const tries = kwRows.slice(0, 4);
  for (const row of tries) {
    lyricSong = row.querySelector('.t-name').textContent;
    row.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    doc.getElementById('lyricsBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    for (let i = 0; i < 12; i++) {
      await sleep(1000);
      const txt = doc.getElementById('lyricsBody').textContent;
      if (!txt.includes('暂无歌词') && txt.trim().length > 20) { lyricText = txt; break; }
      if (i % 4 === 3) doc.getElementById('lyricsBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    }
    if (lyricText) break;
    console.log('       ' + lyricSong + ' 无歌词，换下一首');
  }
  const hasLyric = !!lyricText && !lyricText.includes('暂无歌词') && lyricText.trim().length > 20;
  check('酷我歌词已加载', hasLyric, (lyricSong + ' → ' + lyricText.replace(/\s+/g, ' ').slice(0, 60)));

  console.log('\n错误汇总：' + (errors.length ? errors.join('\n') : '(无)'));
  if (errors.length) process.exitCode = 1;
})();
