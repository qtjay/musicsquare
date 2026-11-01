// 音乐推荐端到端：真实网络，验证推荐列表自动加载 + 换一批 + 点播
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
    window.open = () => null;
    window.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
    window.HTMLMediaElement.prototype.pause = function () {};
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
  const click = el => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));

  await sleep(1500);
  console.log('--- 首次进入：自动加载推荐（真实网络，最多 30s） ---');
  let rows = 0;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    rows = doc.querySelectorAll('#recommendList .track-row').length;
    if (rows > 0) break;
  }
  check('推荐列表已渲染', rows > 0, rows + ' 首');
  check('推荐提示显示关键词', doc.getElementById('recHint').textContent.length > 0,
    doc.getElementById('recHint').textContent);
  const firstTitle = doc.querySelector('#recommendList .track-row .t-name');
  check('首行有歌名', !!firstTitle && firstTitle.textContent.trim().length > 0,
    firstTitle ? firstTitle.textContent.trim() : '无');
  const sources = new Set([...doc.querySelectorAll('#recommendList .track-row .pill .dot')]
    .map(d => d.className.replace('dot ', '')));
  check('推荐含多个音源', sources.size >= 2, [...sources].join(', '));

  console.log('\n--- 换一批 ---');
  const before = [...doc.querySelectorAll('#recommendList .t-name')].map(n => n.textContent).join('|');
  click(doc.getElementById('refreshRecBtn'));
  let after = before;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const now = [...doc.querySelectorAll('#recommendList .t-name')].map(n => n.textContent).join('|');
    if (now && now !== before) { after = now; break; }
  }
  check('换一批后内容变化', after !== before);
  check('换一批后仍有内容', doc.querySelectorAll('#recommendList .track-row').length > 0,
    doc.querySelectorAll('#recommendList .track-row').length + ' 首');

  console.log('\n--- 点击推荐歌曲播放 ---');
  click(doc.querySelector('#recommendList .track-row'));
  let url = '';
  for (let i = 0; i < 25; i++) {
    await sleep(1000);
    url = (doc.getElementById('audio').src || '').trim();
    if (url) break;
  }
  check('已拿到播放链接', !!url, url.slice(0, 70));
  check('链接为 https', url.indexOf('https://') === 0, url.slice(0, 8));
  check('底部播放条同步歌名', doc.getElementById('npName').textContent.trim().length > 0,
    doc.getElementById('npName').textContent.trim());

  console.log('\n--- 搜索面板 ---');
  doc.getElementById('searchInput').dispatchEvent(new window.FocusEvent('focus'));
  check('点开搜索框展开面板', doc.getElementById('searchPanel').classList.contains('show'));
  check('未搜索时展示热门搜索', !doc.getElementById('hotSection').hidden);
  doc.getElementById('searchInput').value = '周杰伦';
  click(doc.getElementById('searchBtn'));
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    if (doc.querySelectorAll('#resultList .track-row').length) break;
  }
  check('搜索结果已渲染', doc.querySelectorAll('#resultList .track-row').length > 0,
    doc.querySelectorAll('#resultList .track-row').length + ' 条');
  check('有结果时切换到结果区', !doc.getElementById('resultSection').hidden);
  // 结果已改到独立「搜索」页展示：搜索后自动切过去，顶栏浮层收起
  check('搜索后自动切到搜索页', !doc.getElementById('view-search').hidden);
  check('搜索后收起顶栏浮层', !doc.getElementById('searchPanel').classList.contains('show'));

  console.log('\n--- 错误汇总 ---');
  console.log(errors.length ? errors.join('\n') : '(无未捕获错误)');
  if (errors.length) process.exitCode = 1;
})();
