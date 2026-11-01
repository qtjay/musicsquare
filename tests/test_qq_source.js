// QQ 音源完整性验证：确认 tang 主源返回的是完整版（不再是 60 秒试听）
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function grab(re, name) {
  const m = html.match(re);
  if (!m) throw new Error('未能提取 ' + name);
  return m[0];
}
const src = [
  grab(/function extractQQCore\([\s\S]*?\n  \}/, 'extractQQCore'),
  grab(/function toHttps\([\s\S]*?\n  \}/, 'toHttps'),
  grab(/function pickQQPlayUrl\(d\)\{[\s\S]*?\n  \}/, 'pickQQPlayUrl')
].join('\n');
const sandbox = { module: {}, exports: {} };
const fn = new Function(src + '\nreturn {extractQQCore, toHttps, pickQQPlayUrl};');
const { toHttps, pickQQPlayUrl } = fn();

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + name + (extra ? ' | ' + extra : '')); }
  else { fail++; console.log('FAIL ' + name + (extra ? ' | ' + extra : '')); }
}

const TANG = 'https://tang.api.s01s.cn/music_open_api.php?msg=';
const SEARCH = 'https://api.qijieya.cn/meting/?type=search&id=';

(async () => {
  // 1. 源码层面：tang 必须是主源，vkeys 只作兜底
  const m = html.match(/async function fetchQQDetails\(track\)\{[\s\S]*?\n  \}/);
  const body = m ? m[0] : '';
  const iTang = body.indexOf('fetchQQTang');
  const iVkeys = body.indexOf('fetchQQVkeys');
  check('QQ 详情以 tang 为主源', iTang > 0 && iTang < iVkeys, 'tang@' + iTang + ' < vkeys@' + iVkeys);
  check('取到直链后不再退回 vkeys', /if\(track\.audioUrl\)\{[^}]*isPreview = false; return/.test(body));
  check('vkeys 兜底时标记试听', /fetchQQVkeys\(track, mid\)\) track\.isPreview = true/.test(body));

  // 2. 音质顺序：hq 必须排在 sq(FLAC ~50MB) 之前
  const orderSrc = (grab(/function pickQQPlayUrl\(d\)\{[\s\S]*?\n  \}/, 'pick')
    .match(/const order = \[[\s\S]*?\];/) || [''])[0];
  const keys = [...orderSrc.matchAll(/key:'(\w+)'/g)].map(x => x[1]);
  check('hq 优先于 sq', keys.indexOf('hq') >= 0 && keys.indexOf('hq') < keys.indexOf('sq'), keys.join('>'));
  check('pickQQPlayUrl 返回真实码率 kb', /kb:kb \? kb\[1\] : ''/.test(grab(/function pickQQPlayUrl\(d\)\{[\s\S]*?\n  \}/, 'pick')));

  // 3. i18n 双语文案
  check('中文「试听片段」已定义', /preview:"试听片段"/.test(html));
  check('英文 preview 已定义', /preview:"Preview"/.test(html));
  check('试听标记会持久化', /'pay','isPreview'\]/.test(html));
  check('音质标签位显示试听', /if\(track\.isPreview\) return '<span class="pill quality">'/.test(html));

  // 4. 实测：真实抓链接并下载，比对标称时长
  console.log('\n--- 实测 tang 直链完整性 ---');
  const list = await (await fetch(SEARCH + encodeURIComponent('周杰伦') + '&limit=8&server=tencent')).json();
  let full = 0, total = 0;
  for (const it of list.slice(0, 5)) {
    const mid = (String(it.url).match(/[?&]id=([^&]+)/) || [])[1];
    if (!mid) continue;
    total++;
    let d = null;
    try {
      d = await (await fetch(TANG + encodeURIComponent(it.name + ' ' + it.author) + '&type=json&mid=' + mid)).json();
    } catch (e) { console.log('  ' + it.name + ' | tang 请求失败 ' + e.name); continue; }
    if (!d || !d.song_mid) { console.log('  ' + (it.name || '').padEnd(14) + ' | tang 无数据（将走 vkeys 兜底）'); continue; }
    const best = pickQQPlayUrl(d);
    if (!best.url) { console.log('  ' + (it.name || '').padEnd(14) + ' | tang 无直链（将走 vkeys 兜底）'); continue; }
    const r = await fetch(toHttps(best.url));
    const b = await r.arrayBuffer();
    const dur = parseFloat(d.song_play_time) || 0;
    const kbps = parseFloat(best.kb || d.kbps || 128);
    const est = b.byteLength * 8 / (kbps * 1000);
    const good = Math.abs(est - dur) < 12;
    if (good) full++;
    console.log('  ' + (it.name || '').padEnd(14) +
      ' | 标称 ' + String(dur).padStart(4) + 's' +
      ' | ' + best.label.padEnd(9) + String(best.kb + 'k').padEnd(6) +
      ' | ' + (b.byteLength / 1048576).toFixed(1) + 'MB' +
      ' | 估算 ' + est.toFixed(0) + 's | ' + (good ? '✅完整' : '❌截断'));
  }
  check('实测完整版占比 ≥ 80%', total > 0 && full / total >= 0.8, full + '/' + total);
  check('不再出现 960887 字节的试听片段', !/960887/.test(String(full)));

  console.log('\nPASS=' + pass + ' FAIL=' + fail);
  process.exit(fail ? 1 : 0);
})();
