// 生成小屏播放页顶部区截图，用于人工确认半圆封面贴顶 + 收起按钮悬浮
const path = require('path');
const { chromium } = require('playwright');

const FILE = 'file:///' + path.join(__dirname, '..', 'index.html').replace(/\\/g, '/');

const COVER_SVG = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">' +
  '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
  '<stop offset="0" stop-color="#7c5cff"/><stop offset="1" stop-color="#ff7ab6"/>' +
  '</linearGradient></defs>' +
  '<rect width="400" height="400" fill="url(#g)"/>' +
  '<circle cx="200" cy="200" r="80" fill="#ffffff" opacity="0.85"/></svg>'
);

(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(700);

  await page.evaluate((svg) => {
    document.body.classList.add('np-mode');
    ['discover', 'favorites', 'history', 'playlists', 'nowplaying'].forEach(v => {
      const el = document.getElementById('view-' + v);
      if (el) el.hidden = (v !== 'nowplaying');
    });
    const cover = document.getElementById('npCoverBig');
    const img = document.createElement('img');
    img.src = svg;
    img.alt = '';
    img.style.cssText = 'position:absolute;left:0;top:-100%;width:100%;height:200%;object-fit:cover';
    cover.innerHTML = '';
    cover.appendChild(img);
    document.getElementById('npNameBig').textContent = '晴天';
    document.getElementById('npArtistBig').textContent = '周杰伦';
    const wrap = document.getElementById('lyricsBody');
    wrap.innerHTML = '<div class="lyrics-title">晴天 - 周杰伦</div>';
    for (let i = 0; i < 24; i++) {
      const d = document.createElement('div');
      d.className = 'lyrics-line' + (i === 3 ? ' active' : '');
      d.textContent = '歌词第 ' + (i + 1) + ' 行内容示例';
      wrap.appendChild(d);
    }
  }, COVER_SVG);

  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(__dirname, 'np_header_390.png') });
  await browser.close();
  console.log('截图已生成: np_header_390.png');
})();
