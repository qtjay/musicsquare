// 小屏（390px）下搜索页与批量操作的可用性检查 + 截图
const path = require('path');
const { chromium } = require('playwright');

const FILE = 'file:///' + path.join(__dirname, '..', 'index.html').replace(/\\/g, '/');

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('PASS ' + name + (extra ? ' | ' + extra : '')); }
  else { fail++; console.log('FAIL ' + name + (extra ? ' | ' + extra : '')); }
};

(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(800);

  // 等推荐加载
  let n = 0;
  for (let i = 0; i < 40; i++) {
    n = await page.$$eval('#recommendList .track-row', els => els.length).catch(() => 0);
    if (n) break;
    await page.waitForTimeout(700);
  }
  check('小屏推荐已加载', n > 0, n + ' 首');

  // 勾选框在小屏可见可点
  const box = await page.$('#recommendList .t-check');
  const boxBox = await box.boundingBox();
  check('小屏勾选框有可点尺寸', boxBox && boxBox.width >= 16 && boxBox.height >= 16,
    boxBox ? Math.round(boxBox.width) + 'x' + Math.round(boxBox.height) : '(无)');

  await box.click();
  await page.waitForTimeout(300);
  const cnt = await page.$eval('.batch-bar[data-batch-scope="recommend"] [data-batch-count]', el => el.textContent);
  check('小屏勾选生效', /1/.test(cnt), cnt);

  // 批量工具条在小屏可见、按钮未溢出
  const barBox = await page.$eval('.batch-bar[data-batch-scope="recommend"]', el => {
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), sw: el.scrollWidth };
  });
  check('批量工具条未横向溢出', barBox.sw <= barBox.w + 1, '内容宽 ' + barBox.sw + ' / 可视宽 ' + barBox.w);
  check('批量工具条高度合理', barBox.h > 20 && barBox.h < 160, barBox.h + 'px');

  // 行内「加入歌单」按钮仍在（小屏保留）
  const addBtn = await page.$('#recommendList .t-act[data-act="add"]');
  check('小屏行内仍保留加入歌单按钮', !!addBtn);

  await page.screenshot({ path: path.join(__dirname, 'batch_390.png') });

  // 搜索页小屏
  await page.fill('#searchInput', '周杰伦');
  await page.click('#searchBtn');
  let sn = 0;
  for (let i = 0; i < 45; i++) {
    sn = await page.$$eval('#resultList .track-row', els => els.length).catch(() => 0);
    if (sn) break;
    await page.waitForTimeout(700);
  }
  check('小屏搜索结果已渲染', sn > 0, sn + ' 条');
  const inSearch = await page.evaluate(() => !document.getElementById('view-search').hidden);
  check('小屏已切到搜索页', inSearch);
  await page.screenshot({ path: path.join(__dirname, 'search_page_390.png') });

  check('无未捕获异常', errors.length === 0, errors.slice(0, 2).join(' | '));

  console.log('\nPASS=' + pass + ' FAIL=' + fail);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
