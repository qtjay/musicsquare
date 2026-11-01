// QQ 音源端到端测试：真实网络，验证 搜索 -> 详情 -> 播放链接 全链路
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const errors = [];

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'https://example.com/',   // 模拟 https 部署环境
  beforeParse(window) {
    window.fetch = (...a) => fetch(...a);          // 用 node 的真实 fetch
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

(async () => {
  const check = (name, cond, extra) => {
    console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  -> ' + extra : ''));
    if (!cond) process.exitCode = 1;
  };

  await sleep(1500);   // 等 init() 完成事件绑定

  console.log('--- 搜索「周杰伦」（真实网络，最多 30s） ---');
  const input = doc.getElementById('searchInput');
  input.value = '周杰伦';
  doc.getElementById('searchBtn').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    if (doc.querySelectorAll('#resultList .track-row').length > 0) break;
  }

  const rows = [...doc.querySelectorAll('#resultList .track-row')];
  check('搜索返回了结果', rows.length > 0, rows.length + ' 条');
  check('搜索状态为完成', doc.getElementById('searchStatus').textContent.includes('完成'),
    doc.getElementById('searchStatus').textContent);
  check('搜索过程无未捕获异常', errors.length === 0, errors.join(' | '));

  const sources = rows.map(r => {
    const p = r.querySelector('.t-tags .pill .dot');
    return p ? p.className.replace('dot ', '') : '?';
  });
  const counts = sources.reduce((m, s) => (m[s] = (m[s] || 0) + 1, m), {});
  console.log('       各音源命中:', JSON.stringify(counts));

  const qqRows = rows.filter((r, i) => sources[i] === 'qq');
  check('QQ 音源有结果', qqRows.length > 0, qqRows.length + ' 条');

  if (!qqRows.length) { console.log('\n未找到 QQ 结果，终止'); return; }

  console.log('\n--- 点击第一条 QQ 结果，验证播放链路 ---');
  const target = qqRows[0];
  const title = target.querySelector('.t-name').textContent;
  console.log('       目标歌曲:', title);
  target.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  let src = '';
  for (let i = 0; i < 25; i++) {
    await sleep(1000);
    src = dom.window.document.getElementById('audio').src || '';
    if (src) break;
  }

  check('已拿到播放链接', !!src, src ? src.slice(0, 110) : '(空)');
  if (src) {
    check('播放链接为 https（避免混合内容拦截）', src.startsWith('https://'), src.slice(0, 8));
    console.log('       正在播放:', doc.getElementById('npName').textContent,
      '| 状态:', doc.getElementById('npTags').textContent.replace(/\s+/g, ' '));
  }

  console.log('\n--- 真实下载前 2KB 验证 ---');
  if (src) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 12000);
      const r = await fetch(src, { headers: { Range: 'bytes=0-2047' }, signal: ctrl.signal });
      clearTimeout(t);
      const buf = await r.arrayBuffer();
      console.log('       下载结果: status=' + r.status, 'bytes=' + buf.byteLength,
        'ct=' + (r.headers.get('content-type') || '-'));
      check('音频可下载', (r.status === 206 || r.ok) && buf.byteLength > 0, buf.byteLength + ' bytes');
      // Range 请求只取前 2KB，总大小要从 Content-Range 的 /total 读
      const cr = r.headers.get('content-range') || '';
      const total = parseInt((cr.match(/\/(\d+)$/) || [])[1], 10);
      if (total) {
        check('完整版（总大小 ≠ 试听片段 960887B）', total !== 960887, total + ' bytes');
        check('完整版（总大小 > 1MB）', total > 1048576, (total / 1048576).toFixed(2) + ' MB');
      } else {
        check('服务端返回 Content-Range 总大小', false, 'cr=' + (cr || '(无)'));
      }
    } catch (e) {
      console.log('       下载失败:', e.name, e.message);
      check('音频可下载', false, e.name);
    }
  }

  console.log('\n错误汇总：' + (errors.length ? errors.join('\n') : '(无)'));
  if (errors.length) process.exitCode = 1;
})();
