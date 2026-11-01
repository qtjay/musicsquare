// 搜索页 + 批量收藏 / 批量加入歌单（真实浏览器）
const path = require('path');
const { chromium } = require('playwright');

const FILE = 'file:///' + path.join(__dirname, '..', 'index.html').replace(/\\/g, '/');

let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('PASS ' + name + (extra ? ' | ' + extra : '')); }
  else { fail++; console.log('FAIL ' + name + (extra ? ' | ' + extra : '')); }
};

async function waitRows(page, sel, timeout = 40000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const n = await page.$$eval(sel, els => els.length).catch(() => 0);
    if (n > 0) return n;
    await page.waitForTimeout(700);
  }
  return 0;
}

const bar = (page, scope) =>
  page.evaluate((s) => {
    const b = document.querySelector('.batch-bar[data-batch-scope="' + s + '"]');
    if (!b) return null;
    return {
      count: (b.querySelector('[data-batch-count]') || {}).textContent || '',
      favDisabled: b.querySelector('[data-batch-act="fav"]').disabled,
      addDisabled: b.querySelector('[data-batch-act="add"]').disabled,
      allChecked: b.querySelector('[data-batch-all]').checked
    };
  }, scope);

(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(800);

  // ---------- 推荐页：批量能力 ----------
  const n = await waitRows(page, '#recommendList .track-row');
  check('推荐列表已加载', n > 0, n + ' 首');

  const barInit = await bar(page, 'recommend');
  check('推荐页有批量工具条', !!barInit, barInit ? barInit.count : '(无)');
  check('未勾选时批量按钮禁用', barInit && barInit.favDisabled && barInit.addDisabled);

  const boxes = await page.$$('#recommendList .t-check');
  check('每行都有勾选框', boxes.length === n, boxes.length + '/' + n);

  // 勾选前 3 首
  for (let i = 0; i < 3; i++) await boxes[i].click();
  await page.waitForTimeout(300);
  const bar3 = await bar(page, 'recommend');
  check('勾选 3 首后计数正确', /3/.test(bar3.count), bar3.count);
  check('勾选后批量按钮启用', !bar3.favDisabled && !bar3.addDisabled);

  // 全选
  await page.click('#recommendList .batch-bar [data-batch-all], .batch-bar[data-batch-scope="recommend"] [data-batch-all]');
  await page.waitForTimeout(400);
  const barAll = await bar(page, 'recommend');
  check('全选后计数等于列表长度', new RegExp(String(n)).test(barAll.count), barAll.count + ' / ' + n);
  check('全选框已勾选', barAll.allChecked);

  // 取消选择
  await page.click('.batch-bar[data-batch-scope="recommend"] [data-batch-act="clear"]');
  await page.waitForTimeout(400);
  const bar0 = await bar(page, 'recommend');
  check('取消选择后计数归零', /0/.test(bar0.count), bar0.count);
  check('取消后按钮重新禁用', bar0.favDisabled);

  // ---------- 批量收藏 ----------
  await page.click('#nav a[data-view="favorites"]');
  await page.waitForTimeout(400);
  const favBefore = await page.$$eval('#favList .track-row', els => els.length).catch(() => 0);
  await page.click('#nav a[data-view="discover"]');
  await page.waitForTimeout(400);

  // 上一步已 clear，这里再兜底确认一次，避免残留勾选把后续点击变成「取消选中」
  await page.evaluate(() => {
    const b = document.querySelector('.batch-bar[data-batch-scope="recommend"] [data-batch-act="clear"]');
    if (b && !b.disabled) b.click();
  });
  await page.waitForTimeout(300);
  const boxes2 = await page.$$('#recommendList .t-check');
  for (let i = 0; i < 4; i++) await boxes2[i].click();
  await page.waitForTimeout(300);
  const bar4 = await bar(page, 'recommend');
  check('收藏前已选 4 首', /4/.test(bar4.count), bar4.count);
  await page.click('.batch-bar[data-batch-scope="recommend"] [data-batch-act="fav"]');
  await page.waitForTimeout(800);
  const toast = await page.$eval('.toast', el => el.textContent).catch(() => '');
  check('批量收藏有提示', /收藏/.test(toast), toast.slice(0, 40));
  check('批量收藏数量正确', /4/.test(toast), toast.slice(0, 40));
  const barAfterFav = await bar(page, 'recommend');
  check('批量收藏后自动清空选择', /0/.test(barAfterFav.count), barAfterFav.count);

  await page.click('#nav a[data-view="favorites"]');
  await page.waitForTimeout(500);
  const favAfter = await page.$$eval('#favList .track-row', els => els.length).catch(() => 0);
  check('批量收藏后收藏数增加', favAfter > favBefore, favBefore + ' → ' + favAfter);

  // ---------- 批量加入歌单 ----------
  await page.click('#nav a[data-view="discover"]');
  await page.waitForTimeout(400);
  const boxes3 = await page.$$('#recommendList .t-check');
  for (let i = 0; i < 5; i++) await boxes3[i].click();
  await page.waitForTimeout(300);
  const bar5 = await bar(page, 'recommend');
  check('加入前已选 5 首', /5/.test(bar5.count), bar5.count);
  await page.click('.batch-bar[data-batch-scope="recommend"] [data-batch-act="add"]');
  await page.waitForTimeout(600);
  const pickShown = await page.$eval('#pickModal', el => el.classList.contains('show')).catch(() => false);
  check('批量加入会弹出歌单选择', pickShown);

  // 没有歌单就先建一个（从弹窗里点「新建歌单」）
  const hasPl = await page.$$eval('#pickList .pick-item', els => els.length).catch(() => 0);
  if (!hasPl) {
    await page.click('#pickNew');
    await page.waitForTimeout(400);
    await page.fill('#plNameInput', '批量测试歌单');
    await page.click('#plConfirm');
    await page.waitForTimeout(800);
    const toast2 = await page.$eval('.toast', el => el.textContent).catch(() => '');
    check('新建歌单后自动加入批量歌曲', /加入/.test(toast2), toast2.slice(0, 40));
    check('新建歌单加入数量正确（5 首）', /5/.test(toast2), toast2.slice(0, 40));
  } else {
    const before = await page.$$eval('#plList .track-row', els => els.length).catch(() => 0);
    await page.click('#pickList .pick-item');
    await page.waitForTimeout(800);
    const toast3 = await page.$eval('.toast', el => el.textContent).catch(() => '');
    check('选择歌单后加入成功', /加入/.test(toast3), toast3.slice(0, 40));
  }

  // 歌单页确认曲目已进
  await page.click('#nav a[data-view="playlists"]').catch(() => {});
  await page.waitForTimeout(500);
  const plCount = await page.$$eval('#plList .track-row', els => els.length).catch(() => 0);
  check('歌单内已有曲目', plCount > 0, plCount + ' 首');

  // ---------- 搜索页 ----------
  console.log('\n--- 搜索页 ---');
  await page.fill('#searchInput', '周杰伦');
  await page.click('#searchBtn');
  const sn = await waitRows(page, '#resultList .track-row', 45000);
  check('搜索结果已渲染', sn > 0, sn + ' 条');
  const inSearch = await page.evaluate(() => ({
    searchView: !document.getElementById('view-search').hidden,
    panelOpen: document.getElementById('searchPanel').classList.contains('show'),
    hint: (document.getElementById('resultHint') || {}).textContent || ''
  }));
  check('已切到搜索页', inSearch.searchView);
  check('顶栏浮层已收起', !inSearch.panelOpen);
  check('搜索页显示关键词', inSearch.hint.includes('周杰伦'), inSearch.hint);
  const sbar = await bar(page, 'results');
  check('搜索页也有批量工具条', !!sbar, sbar ? sbar.count : '(无)');

  check('无未捕获异常', errors.length === 0, errors.slice(0, 2).join(' | '));

  console.log('\nPASS=' + pass + ' FAIL=' + fail);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
