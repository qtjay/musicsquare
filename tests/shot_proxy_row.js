/* 检查新增的「QQ 官方音源代理」输入行在桌面与小屏下都正常，不横向溢出 */
const path = require('path');
const { chromium } = require('playwright');

const FILE = 'file:///' + path.join(__dirname, '..', 'index.html').replace(/\\/g, '/');
let pass = 0, fail = 0;
function check(n, c, x) { console.log((c ? 'PASS  ' : 'FAIL  ') + n + (x ? '  -> ' + x : '')); c ? pass++ : fail++; }

(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  for (const vp of [{ w: 1280, h: 800, tag: '桌面 1280' }, { w: 390, h: 844, tag: '小屏 390' }]) {
    const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h } });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(FILE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);

    // 代理行在歌单管理页里（默认 hidden）。这一步只量布局，直接把它显示出来即可，
    // 不走「新建歌单 → 点侧边栏」的交互路径（小屏下侧边栏是抽屉，按钮在视口外点不到）。
    await page.evaluate(() => {
      const dis = document.getElementById('view-discover');
      const pl = document.getElementById('view-playlists');
      if (dis) dis.hidden = true;
      if (pl) pl.hidden = false;
    });
    await page.waitForTimeout(400);

    const info = await page.evaluate(() => {
      const row = document.querySelector('.proxy-row');
      const input = document.getElementById('qqProxyInput');
      if (!row) return { missing: true };
      const r = row.getBoundingClientRect();
      const ir = input ? input.getBoundingClientRect() : null;
      return {
        visible: r.width > 0 && r.height > 0,
        rowRight: Math.round(r.right),
        rowLeft: Math.round(r.left),
        inputW: ir ? Math.round(ir.width) : 0,
        inputH: ir ? Math.round(ir.height) : 0,
        docW: document.documentElement.clientWidth,
        scrollW: document.documentElement.scrollWidth,
        placeholder: input ? input.placeholder : '',
        value: input ? input.value : ''
      };
    });

    console.log('--- ' + vp.tag + ' ---');
    if (info.missing) { check('代理行存在', false, '未找到 .proxy-row'); continue; }
    check('代理行可见', info.visible, JSON.stringify({ w: info.inputW, h: info.inputH }));
    check('输入框有合理宽度', info.inputW >= 120, info.inputW + 'px');
    check('输入框高度可用（可点）', info.inputH >= 28, info.inputH + 'px');
    check('行不超出视口右侧', info.rowRight <= info.docW + 1, 'right=' + info.rowRight + ' docW=' + info.docW);
    check('页面无横向溢出', info.scrollW <= info.docW + 1, 'scrollW=' + info.scrollW + ' docW=' + info.docW);
    // JS 初始化时会把 HTML 里的默认英文占位符换成当前语言的文案
    check('占位文案已本地化（不再是 HTML 里的默认值）',
      !!info.placeholder && info.placeholder.indexOf('your-worker') < 0, info.placeholder);
    check('默认值为空（默认不走官方接口）', info.value === '', '"' + info.value + '"');
    if (vp.w === 390) await page.screenshot({ path: path.join(__dirname, 'proxy_row_390.png') });
    check('无未捕获异常', errs.length === 0, errs.join(' | '));
    await page.close();
  }
  await browser.close();
  console.log('\n合计：' + pass + ' PASS / ' + fail + ' FAIL');
  if (fail) process.exitCode = 1;
})();
