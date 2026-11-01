// 用预置的本地存储数据验证：继续聆听卡片 / 播放记录列表 / 收藏列表 / 点击续播
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

const seedHistory = {
  version: 1,
  history: [
    { uid: 'netease-111', playedAt: Date.now() - 60000, position: 78, duration: 240,
      track: { uid: 'netease-111', source: 'netease', songid: '111', title: '夜航星', artist: '双声道乐队', album: '星轨漫游', cover: null, keyword: '夜航星', displayIndex: 1 } },
    { uid: 'kuwo-222', playedAt: Date.now() - 7200000, position: 12, duration: 200,
      track: { uid: 'kuwo-222', source: 'kuwo', songid: '222', title: '潮汐来信', artist: '海雾计划', album: '', cover: null, keyword: '潮汐', displayIndex: 1 } }
  ]
};
const seedLibrary = {
  version: 2,
  favorites: [
    { uid: 'qq-333', source: 'qq', songid: '333', title: '逆光奔跑', artist: '追风少年团', album: '破晓之前', cover: null, keyword: '逆光', displayIndex: 1 }
  ],
  playlists: [
    { id: 'pl-1', name: '通勤歌单', tracks: [
      { uid: 'netease-444', source: 'netease', songid: '444', title: '午后抹茶', artist: '一日三餐', album: '', cover: null, keyword: '抹茶', displayIndex: 1 }
    ] }
  ]
};

const errors = [];
const cssText = (html.match(/<style>([\s\S]*?)<\/style>/) || [, ''])[1];
const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'http://localhost/',
  beforeParse(window) {
    window.localStorage.setItem('musicsquare-history-v1', JSON.stringify(seedHistory));
    window.localStorage.setItem('pikachu-music-library-v1', JSON.stringify(seedLibrary));
    window.fetch = () => Promise.reject(new Error('offline-test'));
    window.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
    window.HTMLMediaElement.prototype.pause = function () {};
    window.scrollTo = () => {};
    window.open = () => null;
    // 模拟小屏，验证移动端形态
    Object.defineProperty(window, 'innerWidth', { value: 420, writable: true });
    window.addEventListener('error', e => errors.push('window.error: ' + (e.error && e.error.stack || e.message)));
  }
});
const { window } = dom;
const css = cssText;
const doc = window.document;

setTimeout(() => {
  const check = (name, cond, extra) => {
    console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  -> ' + extra : ''));
    if (!cond) process.exitCode = 1;
  };
  const click = el => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));

  console.log('--- 本地数据回显 ---');
  check('导航播放记录计数=2', doc.getElementById('navHisCount').textContent === '2', doc.getElementById('navHisCount').textContent);
  check('导航收藏计数=1', doc.getElementById('navFavCount').textContent === '1', doc.getElementById('navFavCount').textContent);
  check('侧边栏显示歌单', doc.getElementById('sidebarPlList').textContent.includes('通勤歌单'));
  check('发现页已无「继续聆听」', !doc.getElementById('historyRow'));

  console.log('\n--- 播放记录页 ---');
  click(doc.querySelectorAll('#nav a')[2]);
  const hisText = doc.getElementById('hisList').textContent;
  check('列表含两首歌', hisText.includes('夜航星') && hisText.includes('潮汐来信'));
  check('显示相对时间', /刚刚|分钟前|小时前/.test(hisText), hisText.slice(0, 60).replace(/\s+/g, ' '));
  check('显示上次播放位置', hisText.includes('01:18'), '期望 01:18');

  console.log('\n--- 小屏列表：加入歌单按钮 ---');
  check('小屏显示行内操作区', /@media \(max-width:900px\)\{[\s\S]*?\.t-actions\{display:flex/.test(css));
  check('小屏只保留加入歌单（+）', /\.t-act\[data-act="fav"\],\.t-act\[data-act="download"\],\.t-act\[data-act="remove"\]\{display:none\}/.test(css));
  const addBtn = doc.querySelector('#hisList [data-act="add"]');
  check('历史列表有加入歌单按钮', !!addBtn);
  const plCountBefore = JSON.parse(window.localStorage.getItem('pikachu-music-library-v1')).playlists[0].tracks.length;
  if (addBtn) click(addBtn);
  const plCountAfter = JSON.parse(window.localStorage.getItem('pikachu-music-library-v1')).playlists[0].tracks.length;
  check('点 + 后歌单曲目 +1', plCountAfter === plCountBefore + 1, plCountBefore + ' -> ' + plCountAfter);
  check('歌单内出现该曲目', (window.localStorage.getItem('pikachu-music-library-v1') || '').includes('夜航星'));

  console.log('\n--- 小屏播放条：收藏按钮 ---');
  check('小屏显示右侧工具区', /@media \(max-width:900px\)\{[\s\S]*?\.p-right\{display:flex/.test(css));
  check('播放条栅格改为三列', /@media \(max-width:900px\)\{[\s\S]*?\.player-inner\{grid-template-columns:minmax\(0,1fr\) auto auto/.test(css));
  check('小屏收藏按钮可见（下载/歌词/音量隐藏）',
    /\.p-right #downloadBtn,\.p-right #lyricsBtn,\.p-right \.volume-wrap\{display:none\}/.test(css));
  check('收藏按钮存在', !!doc.getElementById('favBtn'));

  console.log('\n--- 小屏播放页：封面上移露半圆 ---');
  check('封面容器固定为半圆高度', /\.np-cover-big\{[\s\S]*?height:calc\(min\(72vw,300px\) \/ 2\)/.test(css));
  check('封面只保留下半圆轮廓', /\.np-cover-big\{[\s\S]*?border-radius:0 0 calc\(min\(72vw,300px\) \/ 2\) calc\(min\(72vw,300px\) \/ 2\)/.test(css));
  check('封面 img 上移一个半高（露出下半）', /\.np-cover-big img\{position:absolute;left:0;top:-100%;width:100%;height:200%/.test(css));
  check('顶部区从页面顶端开始排列（不留白）', /\.np-left\{[\s\S]*?justify-content:flex-start/.test(css));
  check('不再使用负边距方案', !/margin-bottom:calc\(min\(72vw,300px\) \/ -2\)/.test(css));
  check('小屏隐藏唱片中心孔', /\.np-cover-big::after\{display:none\}/.test(css));
  check('顶部区（返回+封面+歌名）整体吸顶', /\.np-left\{[\s\S]*?position:sticky;top:0/.test(css));
  check('顶部区不收缩', /\.np-left\{[\s\S]*?flex-shrink:0/.test(css));
  check('歌词区独立滚动，不重叠', /\.np-right\{flex:1;min-height:0;overflow:hidden\}/.test(css));
  check('返回按钮已移入顶部区', doc.querySelector('#view-nowplaying .np-left #npBack') !== null);

  console.log('\n--- 封面加载失败兜底 ---');
  check('封面 img 挂了兜底回调', /onerror="coverFallback\(this\)"/.test(html));
  const fb = window.coverFallback;
  check('兜底回调已暴露到 window', typeof fb === 'function');
  if (typeof fb === 'function') {
    // 第一次：换带时间戳的 URL 重试
    const img = doc.createElement('img');
    img.setAttribute('src', 'https://api.qijieya.cn/meting/?server=netease&type=pic&id=123');
    doc.body.appendChild(img);
    fb(img);
    check('首次失败会重试（URL 加时间戳）', img.getAttribute('src').indexOf('_cv=') > 0,
      img.getAttribute('src').slice(-30));
    const parent = doc.createElement('div');
    parent.appendChild(img);
    // 第二次：降级为占位符
    fb(img);
    check('再次失败降级为占位符', parent.querySelector('.ph') !== null && parent.querySelector('img') === null,
      parent.textContent);
  }

  console.log('\n--- 收藏页 ---');
  click(doc.querySelectorAll('#nav a')[1]);
  check('收藏列表含歌曲', doc.getElementById('favList').textContent.includes('逆光奔跑'));
  const favBtn = doc.querySelector('#favList [data-act="fav"]');
  check('收藏按钮为激活态', favBtn && favBtn.classList.contains('fav-on'));
  click(favBtn);
  check('取消收藏后清空', doc.getElementById('favList').textContent.includes('收藏夹还是空的'));
  check('localStorage 同步', !(window.localStorage.getItem('pikachu-music-library-v1') || '').includes('逆光奔跑'));

  console.log('\n--- 播放记录页点击续播（离线应优雅失败） ---');
  click(doc.querySelectorAll('#nav a')[2]);
  click(doc.querySelector('#hisList .track-row'));
  setTimeout(() => {
    check('续播点击无未捕获异常', errors.length === 0, errors.join(' | '));
    check('底部播放条显示歌名', doc.getElementById('npName').textContent.includes('夜航星'),
      doc.getElementById('npName').textContent);

    console.log('\n--- 播放页（小屏沉浸形态） ---');
    check('小屏点击卡片自动进播放页', !doc.getElementById('view-nowplaying').hidden);
    check('body 标记 np-mode', doc.body.classList.contains('np-mode'));
    check('大封面显示歌名', doc.getElementById('npNameBig').textContent.includes('夜航星'),
      doc.getElementById('npNameBig').textContent);
    check('大封面显示歌手', doc.getElementById('npArtistBig').textContent.includes('双声道乐队'),
      doc.getElementById('npArtistBig').textContent);
    check('歌词区已渲染', doc.getElementById('lyricsBody').textContent.length > 0,
      doc.getElementById('lyricsBody').textContent.replace(/\s+/g, ' ').slice(0, 40));
    check('返回按钮位于播放页内', doc.getElementById('view-nowplaying').contains(doc.getElementById('npBack')));
    check('小屏（≤900px）显示返回按钮', /@media \(max-width:900px\)\{[\s\S]*?\.np-back\{[\s\S]*?display:inline-flex/.test(css));
    check('顶部区有背景遮挡滚上来的歌词', /\.np-left\{[\s\S]*?background:linear-gradient/.test(css));
    check('返回按钮文案已本地化', doc.getElementById('npBack').textContent.trim() === '收起',
      doc.getElementById('npBack').textContent.trim());
    click(doc.getElementById('npBack'));
    check('返回后退出播放页', doc.getElementById('view-nowplaying').hidden);
    check('body 移除 np-mode', !doc.body.classList.contains('np-mode'));
    click(doc.getElementById('lyricsBtn'));
    check('歌词按钮可再次进入播放页', !doc.getElementById('view-nowplaying').hidden);
    click(doc.getElementById('lyricsBtn'));
    check('歌词按钮可收起播放页', doc.getElementById('view-nowplaying').hidden);

    console.log('\n--- 小屏抽屉 ---');
    click(doc.getElementById('menuBtn'));
    check('抽屉打开', doc.getElementById('sidebar').classList.contains('open'));
    click(doc.getElementById('sideOverlay'));
    check('遮罩关闭抽屉', !doc.getElementById('sidebar').classList.contains('open'));

    console.log('\n错误汇总：' + (errors.length ? errors.join('\n') : '(无)'));
  }, 600);
}, 500);
