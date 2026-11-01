// 小屏播放页顶部区布局：收起按钮悬浮在半圆封面上，封面贴到最顶端
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
  await page.waitForTimeout(700);

  await page.evaluate(() => {
    document.body.classList.add('np-mode');
    ['discover', 'favorites', 'history', 'playlists', 'nowplaying'].forEach(v => {
      const el = document.getElementById('view-' + v);
      if (el) el.hidden = (v !== 'nowplaying');
    });
  });
  await page.waitForTimeout(400);

  const m = await page.evaluate(() => {
    const back = document.getElementById('npBack');
    const cover = document.getElementById('npCoverBig');
    const left = document.querySelector('.np-left');
    const br = back.getBoundingClientRect();
    const cr = cover.getBoundingClientRect();
    const lr = left.getBoundingClientRect();
    // 按钮中心点最上层是谁
    const cx = Math.round(br.left + br.width / 2);
    const cy = Math.round(br.top + br.height / 2);
    const topEl = document.elementFromPoint(cx, cy);
    // 封面左半区某点（非按钮处）最上层是谁
    const coverProbe = document.elementFromPoint(Math.round(cr.left + cr.width * 0.5), Math.round(cr.top + cr.height * 0.6));
    const cs = getComputedStyle(back);
    return {
      backRect: { top: Math.round(br.top), left: Math.round(br.left), w: Math.round(br.width), h: Math.round(br.height) },
      coverRect: { top: Math.round(cr.top), left: Math.round(cr.left), w: Math.round(cr.width), h: Math.round(cr.height) },
      leftTop: Math.round(lr.top),
      backPosition: cs.position,
      backZ: cs.zIndex,
      backVisible: cs.display !== 'none' && br.width > 0,
      topElAtBackCenter: topEl ? (topEl.id || topEl.className || topEl.tagName) : 'null',
      // 命中元素是按钮本身或其子节点（可能是图标 svg / 文字 span）
      backIsTopmost: !!topEl && back.contains(topEl),
      topElOverCover: coverProbe ? (coverProbe.id || coverProbe.className || coverProbe.tagName) : 'null',
      // 按钮是否与封面区域相交
      overlaps: br.left < cr.right && br.right > cr.left && br.top < cr.bottom && br.bottom > cr.top
    };
  });
  console.log(JSON.stringify(m, null, 2));

  check('收起按钮可见', m.backVisible, m.backRect.w + 'x' + m.backRect.h);
  check('按钮脱离文档流（absolute）', m.backPosition === 'absolute', 'position=' + m.backPosition);
  check('封面已贴到最顶端（top ≤ 2px）', m.coverRect.top <= 2, '封面 top=' + m.coverRect.top + 'px');
  check('按钮悬浮在封面上（区域相交）', m.overlaps,
    '按钮 y=' + m.backRect.top + '~' + (m.backRect.top + m.backRect.h) +
    ' / 封面 y=' + m.coverRect.top + '~' + (m.coverRect.top + m.coverRect.h));
  check('按钮绘制在封面之上', m.backIsTopmost,
    '按钮中心顶层元素=' + m.topElAtBackCenter + '（属于按钮=' + m.backIsTopmost + '）');
  check('封面本身未被按钮意外遮挡', /np-cover-big|npCoverBig|ph/i.test(String(m.topElOverCover)),
    '封面中心顶层=' + m.topElOverCover);

  // 桌面端对照：按钮应恢复隐藏
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(400);
  const d = await page.evaluate(() => {
    const b = document.getElementById('npBack');
    return { display: getComputedStyle(b).display };
  });
  check('桌面端按钮仍隐藏', d.display === 'none', 'display=' + d.display);

  check('无未捕获异常', errors.length === 0, errors.slice(0, 2).join(' | '));

  console.log('\nPASS=' + pass + ' FAIL=' + fail);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
