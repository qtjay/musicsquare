// 基础冒烟：新布局（侧边栏 + 主区 + 底部播放条），离线空数据
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const file = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(file, 'utf8');

const errors = [];
const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'http://localhost/',
  beforeParse(window) {
    window.fetch = () => Promise.reject(new Error('offline-test'));
    window.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
    window.HTMLMediaElement.prototype.pause = function () {};
    window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {} }));
    window.scrollTo = () => {};
    window.open = () => null;
    window.addEventListener('error', e => errors.push('window.error: ' + (e.error && e.error.stack || e.message)));
  }
});

const { window } = dom;
const doc = window.document;

setTimeout(() => {
  const check = (name, cond, extra) => {
    console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  -> ' + extra : ''));
    if (!cond) process.exitCode = 1;
  };
  const click = el => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));

  console.log('--- 运行时错误 ---');
  console.log(errors.length ? errors.join('\n') : '(无)');

  console.log('\n--- 新布局骨架 ---');
  check('标题正确', doc.title.includes('影音共享'), doc.title);
  check('侧边栏存在', !!doc.getElementById('sidebar'));
  check('侧边栏导航 3 项', doc.querySelectorAll('#nav a').length === 3,
    doc.querySelectorAll('#nav a').length + ' 项');
  check('底部播放条存在', !!doc.querySelector('.player'));
  check('主滚动区存在', !!doc.getElementById('mainScroll'));
  check('发现视图可见', !doc.getElementById('view-discover').hidden);
  check('其余视图默认隐藏', ['favorites', 'history', 'playlists', 'nowplaying']
    .every(v => doc.getElementById('view-' + v).hidden));
  check('主题默认已设置', ['light', 'dark'].includes(doc.documentElement.dataset.theme), doc.documentElement.dataset.theme);

  console.log('\n--- 发现页：只保留「音乐推荐」 ---');
  check('推荐列表容器存在', !!doc.getElementById('recommendList'));
  check('「继续聆听」已移除', !doc.getElementById('historyRow'));
  check('发现页「我的歌单」已移除', !doc.getElementById('playlistGrid'));
  check('推荐区显示加载态或空态', doc.getElementById('recommendList').textContent.length > 0,
    doc.getElementById('recommendList').textContent.replace(/\s+/g, ' ').slice(0, 30));
  check('「换一批」按钮存在', !!doc.getElementById('refreshRecBtn'));
  check('热门关键词已渲染（在搜索面板内）', doc.querySelectorAll('#searchPanel #hotKeywords .kw-chip').length > 5,
    doc.querySelectorAll('#hotKeywords .kw-chip').length + ' 个');
  check('音源开关 4 个', doc.querySelectorAll('#sourceChips .chip input').length === 4);
  check('导航计数归零', doc.getElementById('navFavCount').textContent === '0' &&
    doc.getElementById('navHisCount').textContent === '0');

  console.log('\n--- 圆形封面 ---');
  const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  check('播放页大封面为圆形', /\.np-cover-big\{[^}]*border-radius:50%/.test(css));
  check('底部播放条封面为圆形', /\.np-cover\{[^}]*border-radius:50%/.test(css));
  check('播放时有唱片中心孔', /\.np-cover-big\.spinning::after\{[^}]*opacity:1/.test(css));

  console.log('\n--- 搜索面板：默认收起，点开搜索框才展示 ---');
  check('面板默认收起', !doc.getElementById('searchPanel').classList.contains('show'));
  check('未搜索时不显示结果区', doc.getElementById('resultSection').hidden);
  check('未搜索时显示热门搜索', !doc.getElementById('hotSection').hidden);
  doc.getElementById('searchInput').dispatchEvent(new window.FocusEvent('focus', { bubbles: false }));
  check('聚焦搜索框后面板展开', doc.getElementById('searchPanel').classList.contains('show'));
  doc.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
  check('点击空白处面板收起', !doc.getElementById('searchPanel').classList.contains('show'));

  console.log('\n--- 交互：侧边栏导航切换 ---');
  const nav = doc.querySelectorAll('#nav a');
  click(nav[1]);
  check('切到「我喜欢的音乐」', !doc.getElementById('view-favorites').hidden && doc.getElementById('view-discover').hidden);
  check('导航高亮跟随', nav[1].classList.contains('active') && !nav[0].classList.contains('active'));
  click(nav[2]);
  check('切到「历史播放」', !doc.getElementById('view-history').hidden && doc.getElementById('view-favorites').hidden);
  click(nav[0]);
  check('切回「发现音乐」', !doc.getElementById('view-discover').hidden);

  console.log('\n--- 交互：小屏抽屉 ---');
  check('汉堡按钮存在（小屏显示）', !!doc.getElementById('menuBtn'));
  click(doc.getElementById('menuBtn'));
  check('抽屉打开', doc.getElementById('sidebar').classList.contains('open'));
  check('遮罩显示', doc.getElementById('sideOverlay').classList.contains('show'));
  click(doc.getElementById('sideOverlay'));
  check('点遮罩关闭抽屉', !doc.getElementById('sidebar').classList.contains('open') &&
    !doc.getElementById('sideOverlay').classList.contains('show'));

  console.log('\n--- 交互：主题 / 语言 ---');
  const before = doc.documentElement.dataset.theme;
  click(doc.getElementById('themeBtn'));
  const after = doc.documentElement.dataset.theme;
  check('主题已切换', before !== after, before + ' -> ' + after);
  check('主题写入 localStorage', !!window.localStorage.getItem('musicsquare-theme'),
    String(window.localStorage.getItem('musicsquare-theme')));

  click(doc.getElementById('langBtn'));
  check('切到英文', doc.getElementById('langBtn').textContent === '中');
  check('英文文案生效', doc.getElementById('view-discover').textContent.includes('Recommended'));
  click(doc.getElementById('langBtn'));
  check('切回中文', doc.getElementById('langBtn').textContent === 'EN');
  check('中文文案恢复', doc.getElementById('view-discover').textContent.includes('音乐推荐'));

  console.log('\n--- 交互：搜索（离线应报错但不崩） ---');
  doc.getElementById('searchInput').value = '周杰伦';
  click(doc.getElementById('searchBtn'));
  setTimeout(() => {
    check('搜索后无未捕获错误', errors.length === 0, errors.join(' | '));
    check('结果区仍存在', !!doc.getElementById('resultList'));

    console.log('\n--- 交互：快捷键弹窗 ---');
    click(doc.getElementById('shortcutBtn'));
    check('快捷键弹窗打开', doc.getElementById('scModal').classList.contains('show'));
    click(doc.getElementById('scClose'));
    check('快捷键弹窗关闭', !doc.getElementById('scModal').classList.contains('show'));

    console.log('\n--- 交互：无当前歌曲时的播放页 ---');
    click(doc.getElementById('lyricsBtn'));
    check('无歌曲时不进入播放页', doc.getElementById('view-nowplaying').hidden);
    check('给出提示 Toast', doc.getElementById('toast').classList.contains('show'));

    console.log('\n--- 交互：歌词按钮可点击提示 ---');
    const lyricsBtn = doc.getElementById('lyricsBtn');
    check('歌词按钮带文字标签', lyricsBtn.querySelector('.ctrl-label') &&
      lyricsBtn.querySelector('.ctrl-label').textContent.trim().length > 0,
      lyricsBtn.querySelector('.ctrl-label') ? lyricsBtn.querySelector('.ctrl-label').textContent : '无');
    check('歌词按钮为胶囊样式', lyricsBtn.classList.contains('ctrl-lyrics'));

    console.log('\n--- 交互：新建歌单（侧边栏 +） ---');
    click(doc.getElementById('newPlBtn'));
    check('新建歌单弹窗打开', doc.getElementById('plModal').classList.contains('show'));
    doc.getElementById('plNameInput').value = '测试歌单';
    click(doc.getElementById('plConfirm'));
    check('弹窗已关闭', !doc.getElementById('plModal').classList.contains('show'));
    const sidePl = doc.querySelector('#sidebarPlList .side-pl');
    check('侧边栏出现歌单', doc.getElementById('sidebarPlList').textContent.includes('测试歌单'));
    check('默认歌单带星标', !!doc.querySelector('#sidebarPlList .side-pl .star'));
    check('默认歌单有 default 类', sidePl && sidePl.classList.contains('default'));
    check('默认歌单有提示 title', sidePl && sidePl.title.length > 0, sidePl ? sidePl.title : '无');
    check('写入 localStorage', (window.localStorage.getItem('pikachu-music-library-v1') || '').includes('测试歌单'));

    console.log('\n--- 交互：侧边栏歌单进入详情页 ---');
    click(doc.querySelector('#sidebarPlList .side-pl'));
    check('切到歌单详情视图', !doc.getElementById('view-playlists').hidden);
    check('详情空态文案', doc.getElementById('plList').textContent.length > 0);
    check('详情页标注默认歌单', doc.getElementById('plDefaultHint').textContent.includes('默认歌单'),
      doc.getElementById('plDefaultHint').textContent);
    check('下拉框默认项带 ★', (doc.getElementById('plSelect').selectedOptions[0] || {}).textContent.indexOf('★') === 0,
      (doc.getElementById('plSelect').selectedOptions[0] || {}).textContent);

    console.log('\n--- 交互：清空操作（无数据不应报错） ---');
    click(doc.querySelectorAll('#nav a')[2]);
    click(doc.getElementById('clearHistoryBtn2'));
    click(doc.querySelectorAll('#nav a')[1]);
    click(doc.getElementById('clearFavBtn'));
    check('清空操作无异常', errors.length === 0);

    console.log('\n--- 最终错误汇总 ---');
    console.log(errors.length ? errors.join('\n') : '(无运行时错误)');
    if (errors.length) process.exitCode = 1;
  }, 300);
}, 500);
