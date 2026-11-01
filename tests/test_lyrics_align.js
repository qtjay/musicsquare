// 真实浏览器测量：小屏歌词滚动定位是否正确
// 用系统 Edge 打开真实页面，模拟进入播放页并灌入歌词，对比 offsetTop 方案与 rect 方案
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const FILE = 'file:///' + path.join(__dirname, '..', 'index.html').replace(/\\/g, '/');

// 从产品代码里抠出真实的 scrollLyricIntoView，注入页面执行，
// 避免"测试里另写一份算法"造成的假阳性
const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const FN_SRC = (HTML.match(/function scrollLyricIntoView\(wrap, act\)\{[\s\S]*?\n  \}/) || [''])[0];
if (!FN_SRC) { console.error('未能从 index.html 提取 scrollLyricIntoView'); process.exit(1); }

// 造一份 20 行的 LRC，每行 5 秒
function makeLines(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = i * 5;
    const mm = String(Math.floor(t / 60)).padStart(2, '0');
    const ss = String(t % 60).padStart(2, '0');
    out.push('[' + mm + ':' + ss + '.00]歌词第 ' + (i + 1) + ' 行');
  }
  return out;
}

async function measure(page, width, height) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(250);
  return await page.evaluate(async () => {
    const wrap = document.getElementById('lyricsBody');
    const lines = [...wrap.querySelectorAll('.lyrics-line')];
    if (!lines.length) return { error: '没有歌词行' };
    const target = lines[10]; // 取第 11 行做基准
    const wrapRect = wrap.getBoundingClientRect();
    const actRect = target.getBoundingClientRect();

    const oldTarget = target.offsetTop - wrap.clientHeight * 0.45;
    const newTarget = wrap.scrollTop + (actRect.top - wrapRect.top) - wrap.clientHeight * 0.45;

    // 执行产品里真实的函数
    window.__scrollLyricIntoView(wrap, target);
    await new Promise(r => setTimeout(r, 400)); // 等 smooth 滚动结束
    const afterRect = target.getBoundingClientRect();
    const landedAt = afterRect.top - wrapRect.top; // 期望 ≈ 0.45*clientHeight

    return {
      wrapClientHeight: Math.round(wrap.clientHeight),
      wrapScrollHeight: Math.round(wrap.scrollHeight),
      wrapTopInBody: Math.round(wrapRect.top),
      // offsetTop 是相对谁的？
      offsetParent: target.offsetParent ? (target.offsetParent.tagName + '.' + target.offsetParent.className) : 'null',
      targetOffsetTop: target.offsetTop,
      // 行在容器内容坐标系里的真实位置
      realPosInContent: Math.round(wrap.scrollTop + (actRect.top - wrapRect.top)),
      oldTarget: Math.round(oldTarget),
      newTarget: Math.round(newTarget),
      overshoot: Math.round(oldTarget - newTarget),
      landedAt: Math.round(landedAt),
      expected: Math.round(wrap.clientHeight * 0.45)
    };
  });
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(600);

  // 进入播放页形态：隐藏顶栏、切到 nowplaying、灌入歌词
  await page.evaluate((lrcLines) => {
    document.body.classList.add('np-mode');
    ['discover', 'favorites', 'history', 'playlists', 'nowplaying'].forEach(v => {
      const el = document.getElementById('view-' + v);
      if (el) el.hidden = (v !== 'nowplaying');
    });
    const wrap = document.getElementById('lyricsBody');
    wrap.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'lyrics-title';
    head.textContent = '晴天 - 周杰伦';
    wrap.appendChild(head);
    lrcLines.forEach((txt, i) => {
      const d = document.createElement('div');
      d.className = 'lyrics-line';
      d.dataset.index = String(i);
      d.textContent = txt.replace(/^\[\d{2}:\d{2}\.\d{2}\]/, '');
      wrap.appendChild(d);
    });
  }, makeLines(20));
  await page.waitForTimeout(300);

  // 注入产品里真实的滚动函数
  await page.evaluate((src) => {
    window.__scrollLyricIntoView = new Function('return (' + src + ')')();
  }, FN_SRC);
  const injected = await page.evaluate(() => typeof window.__scrollLyricIntoView === 'function');
  if (!injected) { console.error('注入失败'); await browser.close(); process.exit(1); }

  let pass = 0, fail = 0;
  const check = (name, cond, extra) => {
    if (cond) { pass++; console.log('PASS ' + name + (extra ? ' | ' + extra : '')); }
    else { fail++; console.log('FAIL ' + name + (extra ? ' | ' + extra : '')); }
  };

  console.log('=== 小屏 390x844 ===');
  const m = await measure(page, 390, 844);
  console.log(JSON.stringify(m, null, 2));

  check('歌词容器可滚动', m.wrapScrollHeight > m.wrapClientHeight + 50,
    m.wrapScrollHeight + ' > ' + m.wrapClientHeight);
  check('offsetParent 不是歌词容器（证实 bug 前提）',
    !/lyrics-body/.test(m.offsetParent || ''), 'offsetParent=' + m.offsetParent);
  check('旧方案确实过冲（>100px）', m.overshoot > 100, '过冲 ' + m.overshoot + 'px');
  check('新方案落点正确（误差 <12px）', Math.abs(m.landedAt - m.expected) < 12,
    '落点 ' + m.landedAt + ' / 期望 ' + m.expected);

  console.log('\n=== 桌面 1440x900（对照）===');
  const d = await measure(page, 1440, 900);
  console.log(JSON.stringify(d, null, 2));
  check('桌面落点同样正确', Math.abs(d.landedAt - d.expected) < 12,
    '落点 ' + d.landedAt + ' / 期望 ' + d.expected);
  // 桌面端同样有 80+px 的过冲（≈2~3 行），只是没有小屏的 222px 那么刺眼
  check('桌面端同样存在过冲（说明是通病）', d.overshoot > 40, '桌面过冲 ' + d.overshoot + 'px');
  check('小屏过冲明显更严重', m.overshoot > d.overshoot * 1.5,
    '小屏 ' + m.overshoot + 'px vs 桌面 ' + d.overshoot + 'px');

  check('无未捕获异常', errors.length === 0, errors.join(' | '));

  console.log('\nPASS=' + pass + ' FAIL=' + fail);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
