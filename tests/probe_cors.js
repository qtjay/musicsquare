/* 决定性验证：把洛雪用的各家官方接口，按「浏览器 fetch」的标准打一遍，
   看服务端到底返回不返回 Access-Control-Allow-Origin。
   没有 ACAO = 纯前端 HTML 直连必被拦，必须走服务端代理。 */
const crypto = require('crypto');

/* ---- 洛雪 tx/utils/crypto.js 的 zzcSign 原样移植（node 版） ---- */
const PART_1_INDEXES = [23, 14, 6, 36, 16, 40, 7, 19];
const PART_2_INDEXES = [16, 1, 32, 12, 19, 27, 8, 5];
const SCRAMBLE_VALUES = [89, 39, 179, 150, 218, 82, 58, 252, 177, 52, 186, 123, 120, 64, 242, 133, 143, 161, 121, 179];
function zzcSign(text) {
  const hash = crypto.createHash('sha1').update(text).digest('hex');
  const part1 = PART_1_INDEXES.map(i => hash[i]).join('');
  const part2 = PART_2_INDEXES.map(i => hash[i]).join('');
  const part3 = SCRAMBLE_VALUES.map((v, i) => v ^ parseInt(hash.slice(i * 2, i * 2 + 2), 16));
  const b64 = Buffer.from(part3).toString('base64').replace(/[\\/+=]/g, '');
  return `zzc${part1}${b64}${part2}`.toLowerCase();
}

const UA_PC = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';

async function probe(label, url, opts) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, Object.assign({ redirect: 'follow', signal: ctrl.signal }, opts || {}));
    const acao = r.headers.get('access-control-allow-origin');
    const acam = r.headers.get('access-control-allow-methods');
    let body = '';
    try { body = (await r.text()).slice(0, 160); } catch (e) { body = '(读取失败)'; }
    console.log('  ' + label);
    console.log('      HTTP ' + r.status + '  ACAO=' + (acao === null ? '【无】' : acao) + '  methods=' + (acam || '-'));
    console.log('      body: ' + body.replace(/\s+/g, ' '));
  } catch (e) {
    console.log('  ' + label);
    console.log('      x ' + (e.name === 'AbortError' ? 'TIMEOUT' : e.message));
  } finally { clearTimeout(t); }
}

/* 预检（OPTIONS）—— 浏览器对非简单请求会先发这个，这是真正的生死线 */
async function preflight(url, method, headers) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(url, {
      method: 'OPTIONS', signal: ctrl.signal, redirect: 'follow',
      headers: {
        'Origin': 'https://example.com',
        'Access-Control-Request-Method': method,
        'Access-Control-Request-Headers': headers.join(',')
      }
    });
    console.log('      预检 OPTIONS -> HTTP ' + r.status +
      ' ACAO=' + (r.headers.get('access-control-allow-origin') ?? '【无】') +
      ' allow-methods=' + (r.headers.get('access-control-allow-methods') ?? '-') +
      ' allow-headers=' + ((r.headers.get('access-control-allow-headers') || '').slice(0, 60) || '-'));
  } catch (e) {
    console.log('      预检 OPTIONS -> x ' + (e.name === 'AbortError' ? 'TIMEOUT' : e.message));
  } finally { clearTimeout(t); }
}

(async () => {
  console.log('=== 1. QQ 官方接口 u.y.qq.com（洛雪 tx 走的就是这个）===');
  const searchBody = {
    comm: { _channelid: '0', ct: '19', cv: '2151', guid: '1F70E520B2EAA7D25E11760783C53CA9', uin: '0', tmeAppID: 'qqmusic' },
    'music.search.SearchCgiService': {
      module: 'music.search.SearchCgiService',
      method: 'DoSearchForQQMusicDesktop',
      param: { grp: 1, num_per_page: 5, page_num: 1, query: '发如雪', remoteplace: 'txt.newclient.top', search_type: 0, searchid: '1F70E520B2EAA7D25E11760783C53CA' + '00001' }
    }
  };
  const sign = zzcSign(JSON.stringify(searchBody));
  await probe('搜索 musics.fcg (POST + sign)', 'https://u.y.qq.com/cgi-bin/musics.fcg?sign=' + sign, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'QQMusic 14090508(android 12)', 'Origin': 'https://example.com' },
    body: JSON.stringify(searchBody)
  });
  await preflight('https://u.y.qq.com/cgi-bin/musics.fcg', 'POST', ['content-type']);

  const detailBody = {
    comm: { ct: '19', cv: '1859', uin: '0' },
    req: { module: 'music.pf_song_detail_svr', method: 'get_song_detail_yqq', param: { song_type: 0, song_mid: '0027oMO61wWi55' } }
  };
  await probe('详情 musicu.fcg (POST，洛雪 musicInfo 无签名)', 'https://u.y.qq.com/cgi-bin/musicu.fcg', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA_PC, 'Origin': 'https://example.com' },
    body: JSON.stringify(detailBody)
  });
  await preflight('https://u.y.qq.com/cgi-bin/musicu.fcg', 'POST', ['content-type']);

  console.log('\n=== 2. 酷我官方接口 search.kuwo.cn（洛雪 kw 走的老接口）===');
  await probe('搜索 r.s', 'http://search.kuwo.cn/r.s?client=kt&all=' + encodeURIComponent('发如雪') +
    '&pn=0&rn=5&uid=794762570&ver=kwplayer_ar_9.2.2.1&vipver=1&ft=music&cluster=0&strategy=2012&encoding=utf8&rformat=json&vermerge=1&mobi=1&issubtitle=1',
    { method: 'GET', headers: { 'Origin': 'https://example.com', 'User-Agent': UA_PC } });

  console.log('\n=== 3. 酷我 www 接口 musicInfo（洛雪 kw/index.js 用）===');
  await probe('musicInfo', 'http://www.kuwo.cn/api/www/music/musicInfo?mid=118990',
    { method: 'GET', headers: { 'Origin': 'https://example.com', 'User-Agent': UA_PC } });

  console.log('\n=== 4. 网易官方（先测端点可达性）===');
  await probe('music.163.com 首页', 'https://music.163.com/',
    { method: 'GET', headers: { 'Origin': 'https://example.com', 'User-Agent': UA_PC } });

  console.log('\n=== 5. 酷狗移动 API ===');
  await probe('酷狗搜索 mobilecdnbj.kugou.com',
    'https://mobilecdnbj.kugou.com/api/v3/search/song?keyword=' + encodeURIComponent('发如雪') +
    '&page=1&pagesize=5&userid=0&platform=WebFilter&tag=em&filter=2&iscorrection=1&mid=' + Date.now(),
    { method: 'GET', headers: { 'Origin': 'https://example.com', 'User-Agent': UA_PC } });

  console.log('\n=== 6. 对照：用户现在在用的第三方 API（为什么它能工作）===');
  await probe('api.qijieya.cn/meting 网易搜索', 'https://api.qijieya.cn/meting/?type=search&id=' + encodeURIComponent('发如雪') + '&limit=3&server=netease',
    { method: 'GET', headers: { 'Origin': 'https://example.com', 'User-Agent': UA_PC } });
  await probe('tang.api.s01s.cn QQ 搜索', 'https://tang.api.s01s.cn/music_open_api.php?msg=' + encodeURIComponent('发如雪') + '&type=json',
    { method: 'GET', headers: { 'Origin': 'https://example.com', 'User-Agent': UA_PC } });
})();
