// 端到端：真实搜索 → 播放 → 等歌词滚动 → 校验高亮行是否落在锚点位置
// 验证的是滚动定位，不校验歌词文本来源
const path = require('path');
const { chromium } = require('playwright');

const FILE = 'file:///' + path.join(__dirname, '..', 'index.html').replace(/\\/g, '/');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  let pass = 0, fail = 0;
  const check = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name + (extra ? ' | ' + extra : '')); }
    else { fail++; console.log('FAIL ' + name + (extra ? ' | ' + extra : '')); }
  };

  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(800);

  await page.fill('#searchInput', '周杰伦');
  await page.click('#searchBtn');
  // 三个音源并发，弱网下可能要十几秒，轮询等待
  let rows = [];
  for (let i = 0; i < 25; i++) {
    await page.waitForTimeout(1000);
    rows = await page.$$('#resultList .track-row');
    if (rows.length) break;
    if (i === 12) await page.click('#searchBtn'); // 中途补一次
  }
  check('搜索到结果', rows.length > 0, rows.length + ' 条');
  if (!rows.length) { await browser.close(); process.exit(1); }

  let played = false;
  const rowCount = Math.min(rows.length, 8);
  for (let ri = 0; ri < rowCount; ri++) {
    // 列表会重渲染，元素句柄会失效，必须每次重新查询
    const list = await page.$$('#resultList .track-row');
    if (ri >= list.length) break;
    try { await list[ri].click(); } catch (e) { continue; }
    // 等音源解析
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(1000);
      const st = await page.evaluate(() => {
        const a = document.getElementById('audio');
        return { src: a.currentSrc || a.src || '', t: a.currentTime || 0, paused: a.paused };
      });
      if (st.src && st.t > 1) { played = true; break; }
    }
    if (played) break;
  }
  check('已开始播放', played);

  // 小屏播放条的歌词按钮被隐藏，用迷你播放条入口（#miniNp）进入播放页
  const before = await page.evaluate(() => ({
    hidden: document.getElementById('view-nowplaying').hidden,
    hasMini: !!document.getElementById('miniNp')
  }));
  await page.evaluate(() => {
    // 只有不在播放页时才点，避免点成"收起"
    if (document.getElementById('view-nowplaying').hidden) {
      const m = document.getElementById('miniNp');
      if (m) m.click();
    }
  });
  await page.waitForTimeout(1500);
  const inNp = await page.evaluate(() => !document.getElementById('view-nowplaying').hidden);
  check('已进入播放页', inNp, '切换前 hidden=' + before.hidden + ' / miniNp=' + before.hasMini);
  if (!inNp) { await browser.close(); process.exit(1); }

  // 跳到 90 秒处，等歌词追上
  await page.evaluate(() => { const a = document.getElementById('audio'); a.currentTime = 90; });
  await page.waitForTimeout(4000);

  const snap = await page.evaluate(() => {
    const wrap = document.getElementById('lyricsBody');
    const act = wrap.querySelector('.lyrics-line.active');
    if (!act) return { hasActive: false, total: wrap.querySelectorAll('.lyrics-line').length };
    const wrapRect = wrap.getBoundingClientRect();
    const actRect = act.getBoundingClientRect();
    const a = document.getElementById('audio');
    return {
      hasActive: true,
      total: wrap.querySelectorAll('.lyrics-line').length,
      activeIndex: Number(act.dataset.index),
      activeText: act.textContent.slice(0, 20),
      audioTime: Math.round(a.currentTime),
      landedAt: Math.round(actRect.top - wrapRect.top),
      expected: Math.round(wrap.clientHeight * 0.45),
      clientHeight: Math.round(wrap.clientHeight),
      // 高亮行是否还在可视区内
      visible: actRect.bottom > wrapRect.top && actRect.top < wrapRect.bottom
    };
  });
  console.log(JSON.stringify(snap, null, 2));

  check('存在高亮行', snap.hasActive, '共 ' + snap.total + ' 行');
  if (snap.hasActive) {
    check('高亮行在可视区内', snap.visible);
    check('高亮行落在锚点附近（误差 <20px）',
      Math.abs(snap.landedAt - snap.expected) < 20,
      '落点 ' + snap.landedAt + ' / 期望 ' + snap.expected);
  }
  check('无未捕获异常', errors.length === 0, errors.slice(0, 2).join(' | '));

  console.log('\nPASS=' + pass + ' FAIL=' + fail);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
