/* 验证两处新落地的能力：
   A. 洛雪 findMusic 风格的跨源匹配（crossCompare / crossTier / parseIntervalSec 等）
   B. 浏览器 WebCrypto 版 zzcSign 与 Node crypto 版逐字节一致
   全部用真实数据，不做 mock。 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const nodeCrypto = require('crypto');

const HTML = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(HTML, 'utf8');
const errors = [];

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.com/',
  beforeParse(window) {
    window.fetch = (...a) => fetch(...a);
    window.AbortController = AbortController;
    window.scrollTo = () => {};
    window.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
    window.HTMLMediaElement.prototype.pause = function () {};
    window.open = () => null;
    // jsdom 不提供 WebCrypto，用 node 的 webcrypto 顶上，这样才能测到 zzcSign 的真实实现
    if (!window.crypto || !window.crypto.subtle) {
      Object.defineProperty(window, 'crypto', { value: nodeCrypto.webcrypto, configurable: true });
    }
    window.addEventListener('error', e => errors.push((e.error && e.error.stack) || e.message));
  }
});
const { window } = dom;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
function check(name, cond, extra) {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  -> ' + extra : ''));
  cond ? pass++ : fail++;
}

/* 从 index.html 抽出被测的纯函数注入页面上下文 */
function fn(name) {
  // 注意要带上可选的 async 前缀，否则 async 函数会被抽成普通函数、里面的 await 直接语法错
  const re = new RegExp('(async\\s+)?function\\s+' + name + '\\s*\\(');
  const m = re.exec(html);
  if (!m) throw new Error('找不到函数 ' + name);
  const idx = m.index;
  let depth = 0, started = false;
  for (let i = idx; i < html.length; i++) {
    if (html[i] === '{') { depth++; started = true; }
    else if (html[i] === '}') { depth--; if (started && depth === 0) return html.slice(idx, i + 1); }
  }
  throw new Error(name + ' 括号未闭合');
}
function constOf(name) {
  const idx = html.indexOf('const ' + name + ' =');
  if (idx < 0) throw new Error('找不到常量 ' + name);
  let depth = 0, started = false;
  for (let i = idx; i < html.length; i++) {
    if (html[i] === '[' || html[i] === '{') { depth++; started = true; }
    else if (html[i] === ']' || html[i] === '}') { depth--; if (started && depth === 0) return html.slice(idx, i + 1) + ';'; }
  }
  throw new Error(name + ' 未闭合');
}

(async () => {
  await sleep(1500);
  window.eval(
    constOf('CROSS_VERSION_CHARS') + '\n' +
    fn('crossFilterStr') + '\n' +
    fn('crossSortSinger') + '\n' +
    fn('parseIntervalSec') + '\n' +
    fn('sameVersionChars') + '\n' +
    fn('crossCompare') + '\n' +
    constOf('CROSS_TIERS') + '\n' +
    fn('crossTier') + '\n'
  );
  const W = window;

  console.log('--- A1. 时长解析（三种写法都要能认）---');
  check('酷我 "299"', W.parseIntervalSec('299') === 299, String(W.parseIntervalSec('299')));
  check('Joox "04:59"', W.parseIntervalSec('04:59') === 299, String(W.parseIntervalSec('04:59')));
  check('vkeys "4分29秒"', W.parseIntervalSec('4分29秒') === 269, String(W.parseIntervalSec('4分29秒')));
  check('缺时长返回 0', W.parseIntervalSec(undefined) === 0, String(W.parseIntervalSec(undefined)));

  console.log('\n--- A2. 跨源判定（真实曲目名）---');
  const T = (title, artist, album, sec) => ({ title, artist, album, sec });
  const cases = [
    { name: '原唱 vs 原唱（应命中）', t: T('发如雪', '周杰伦', '十一月的萧邦', 299),
      c: { title: '发如雪', artist: '周杰伦', album: '十一月的萧邦', sec: 299 }, want: true },
    { name: '原唱 vs Live 版（应排除，防串歌）', t: T('晴天', '周杰伦', '', 269),
      c: { title: '晴天 (Live)', artist: '周杰伦', album: '', sec: 280 }, want: false },
    { name: '原唱 vs 伴奏版（应排除）', t: T('发如雪', '周杰伦', '', 299),
      c: { title: '发如雪 (伴奏)', artist: '周杰伦', album: '', sec: 299 }, want: false },
    { name: '原唱 vs 翻唱/女声版（歌手不同，应排除）', t: T('发如雪', '周杰伦', '', 299),
      c: { title: '发如雪 (女声版)', artist: '余不不', album: '', sec: 0 }, want: false },
    { name: '时长差 60 秒（应排除）', t: T('晴天', '周杰伦', '', 269),
      c: { title: '晴天', artist: '周杰伦', album: '', sec: 329 }, want: false },
    { name: '时长差 3 秒（应命中，±5 容差）', t: T('晴天', '周杰伦', '', 269),
      c: { title: '晴天', artist: '周杰伦', album: '', sec: 272 }, want: true },
    { name: '多歌手顺序不同（应命中）', t: T('屋顶', '周杰伦/温岚/吴宗宪', '', 0),
      c: { title: '屋顶', artist: '温岚/周杰伦/吴宗宪', album: '', sec: 0 }, want: true },
    { name: '候选缺时长（网易，应跳过该维度命中）', t: T('发如雪', '周杰伦', '', 299),
      c: { title: '发如雪', artist: '周杰伦', album: '', sec: 0 }, want: true },
    { name: '完全不相干（应排除）', t: T('发如雪', '周杰伦', '', 299),
      c: { title: '七里香', artist: '周杰伦', album: '', sec: 299 }, want: false }
  ];
  for (const c of cases) {
    const m = W.crossCompare(c.c, c.t);
    const got = m !== null;
    check(c.name, got === c.want, got ? ('命中 tier=' + W.crossTier(m)) : '排除');
  }

  console.log('\n--- A3. 9 级优先级排序 ---');
  const t2 = T('发如雪', '周杰伦', '十一月的萧邦', 299);
  const mk = (title, artist, album, sec) => ({ c: { title, artist, album, sec } });
  const pool = [
    mk('发如雪', '周杰伦', '', 0),            // 缺时长、缺专辑 → tier 2（singerEq && nameEq）
    mk('发如雪', '周杰伦', '十一月的萧邦', 299), // 全中 → tier 0
    mk('发如雪', '周杰伦', '', 299)            // nameEq && secEq → tier 3
  ].map(x => {
    const m = W.crossCompare(x.c, t2);
    return { c: x.c, tier: m ? W.crossTier(m) : 99 };
  }).sort((a, b) => a.tier - b.tier);
  console.log('       排序结果: ' + pool.map(p => 'tier' + p.tier + '(' + p.c.title + '/' + (p.c.sec || '-') + 's)').join('  '));
  check('最优的一条是元数据最全的', pool[0].c.sec === 299 && pool[0].c.album === '十一月的萧邦',
    'tier=' + pool[0].tier);
  check('tier 数值随信息完整度单调', pool[0].tier <= pool[1].tier && pool[1].tier <= pool[2].tier,
    pool.map(p => p.tier).join(' <= '));

  console.log('\n--- B. zzcSign（浏览器 WebCrypto 版 vs Node 版）---');
  const nodeSign = (text) => {
    const h = nodeCrypto.createHash('sha1').update(text).digest('hex');
    const P1 = [23, 14, 6, 36, 16, 40, 7, 19], P2 = [16, 1, 32, 12, 19, 27, 8, 5];
    const SV = [89, 39, 179, 150, 218, 82, 58, 252, 177, 52, 186, 123, 120, 64, 242, 133, 143, 161, 121, 179];
    const p1 = P1.map(i => h[i]).join(''), p2 = P2.map(i => h[i]).join('');
    const p3 = SV.map((v, i) => v ^ parseInt(h.slice(i * 2, i * 2 + 2), 16));
    return ('zzc' + p1 + Buffer.from(p3).toString('base64').replace(/[\\/+=]/g, '') + p2).toLowerCase();
  };
  window.eval(
    constOf('QQ_SIGN_PART1') + '\n' + constOf('QQ_SIGN_PART2') + '\n' +
    constOf('QQ_SIGN_SCRAMBLE') + '\n' + fn('zzcSign') + '\n' + fn('qqSearchId') + '\n'
  );
  const samples = [
    '{"comm":{"ct":"19","cv":"1859","uin":"0"}}',
    JSON.stringify({ 'music.search.SearchCgiService': { method: 'DoSearchForQQMusicDesktop', param: { query: '发如雪' } } }),
    JSON.stringify({ req_0: { module: 'music.pf_song_detail_svr', param: { song_mid: '0027oMO61wWi55' } } }),
    '短文本',
    JSON.stringify({ a: '中文内容', b: [1, 2, 3], c: { d: '嵌套' } })
  ];
  let allEq = true;
  for (const s of samples) {
    const nodeV = nodeSign(s);
    const webV = await W.zzcSign(s);
    const eq = nodeV === webV;
    if (!eq) allEq = false;
    console.log('       ' + (eq ? '一致' : '不一致') + '  node=' + nodeV + '  web=' + webV);
  }
  check('5 个样本签名逐字节一致', allEq, allEq ? '全部一致' : '存在差异');
  check('签名形态为 zzc 开头、全小写', /^zzc[0-9a-z]+$/.test(await W.zzcSign(samples[0])),
    await W.zzcSign(samples[0]));
  const sid = W.qqSearchId();
  check('searchid 为 37 位（32 位 GUID + 5 位补零）', sid.length === 37 && /^[0-9A-F]{32}\d{5}$/.test(sid), sid);

  console.log('\n--- B2. 端到端：用浏览器版算出的签名真打官方接口 ---');
  {
    const payload = {
      comm: { ct: '19', cv: '1859', uin: '0' },
      req: { module: 'music.pf_song_detail_svr', method: 'get_song_detail_yqq',
        param: { song_type: 0, song_mid: '0027oMO61wWi55' } }
    };
    const webSigned = await W.zzcSign(JSON.stringify(payload));
    const r = await fetch('https://u.y.qq.com/cgi-bin/musics.fcg?sign=' + webSigned, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'QQMusic 14090508(android 12)' },
      body: JSON.stringify(payload)
    });
    const j = await r.json();
    console.log('       HTTP ' + r.status + ' code=' + j.code +
      '  曲名=' + ((((j.req || j['music.pf_song_detail_svr'] || {}).data || {}).track_info || {}).title || '-'));
    check('官方接口接受浏览器版签名', r.status === 200 && j.code === 0, 'code=' + j.code);
  }
  {
    const searchPayload = {
      comm: { ct: '19', cv: '2151', guid: '1F70E520B2EAA7D25E11760783C53CA9', uin: '0', tmeAppID: 'qqmusic' },
      'music.search.SearchCgiService': {
        module: 'music.search.SearchCgiService', method: 'DoSearchForQQMusicDesktop',
        param: { grp: 1, num_per_page: 3, page_num: 1, query: '发如雪',
          remoteplace: 'txt.newclient.top', search_type: 0, searchid: W.qqSearchId() }
      }
    };
    const r2 = await fetch('https://u.y.qq.com/cgi-bin/musics.fcg?sign=' + await W.zzcSign(JSON.stringify(searchPayload)), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'QQMusic 14090508(android 12)' },
      body: JSON.stringify(searchPayload)
    });
    const j2 = await r2.json();
    const req2 = j2['music.search.SearchCgiService'] || j2.req;
    const list = (req2 && req2.data && req2.data.body && req2.data.body.song && req2.data.body.song.list) || [];
    console.log('       搜索返回 ' + list.length + ' 条' + (list[0] ? '，首条 ' + list[0].title + ' / ' +
      (list[0].singer || []).map(s => s.name).join('、') + ' / interval=' + list[0].interval : ''));
    check('官方搜索可用且解析路径正确', list.length > 0, list.length + ' 条');
    check('官方搜索带回时长（跨源匹配要用）', list[0] && !!list[0].interval, list[0] ? String(list[0].interval) : '-');
  }

  console.log('\n--- C. 默认无代理时不应改变行为 ---');
  check('getQQProxy 默认为空', W.getQQProxy ? W.getQQProxy() === '' : true,
    W.getQQProxy ? JSON.stringify(W.getQQProxy()) : '(未暴露)');
  const proxyInput = dom.window.document.getElementById('qqProxyInput');
  check('代理输入框存在且默认空', !!proxyInput && proxyInput.value === '', proxyInput ? '"' + proxyInput.value + '"' : '缺失');

  console.log('\n运行期错误：' + (errors.length ? errors.join(' | ') : '(无)'));
  check('无未捕获异常', errors.length === 0, errors.length + ' 个');
  console.log('\n合计：' + pass + ' PASS / ' + fail + ' FAIL');
  if (fail) process.exitCode = 1;
})();
