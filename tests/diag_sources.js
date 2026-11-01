/* 深入核实三处疑点：
   1) 网易 url 接口返回的是不是可直接播放的音频流（我上一版脚本错把它当 JSON 了）
   2) QQ tang 详情为什么没有 song_play_url_* —— 是接口变了还是 VIP 限制
   3) 酷我歌词 127B 是什么内容 */
const KW = process.argv[2] || '周杰伦';
const KW2 = process.argv[3] || '孤勇者';

function toHttps(u){ return String(u || '').replace(/^http:\/\//i, 'https://'); }
async function req(url, extra, ms){
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms || 12000);
  try{
    const r = await fetch(url, Object.assign({redirect:'follow', signal:ctrl.signal,
      headers:{'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120'}}, extra || {}));
    return r;
  }finally{ clearTimeout(timer); }
}
async function probe(url, extra){
  const r = await req(url, Object.assign({method:'GET', headers:Object.assign({'Range':'bytes=0-2047',
    'User-Agent':'Mozilla/5.0', 'Referer':'https://y.qq.com/'}, (extra && extra.headers) || {})}, extra || {}));
  const range = r.headers.get('content-range') || '';
  const m = range.match(/\/(\d+)\s*$/);
  const len = r.headers.get('content-length');
  const total = m ? parseInt(m[1],10) : (len ? parseInt(len,10) : 0);
  return {status:r.status, type:r.headers.get('content-type')||'', total:total, final:r.url.slice(0,90)};
}
async function probeFull(url){
  const r = await req(url, {method:'GET', headers:{'Range':'bytes=0-2047','User-Agent':'Mozilla/5.0','Referer':'https://y.qq.com/'}});
  const range = r.headers.get('content-range') || '';
  const m = range.match(/\/(\d+)\s*$/);
  return {status:r.status, type:r.headers.get('content-type')||'',
    total:m?parseInt(m[1],10):0};
}

(async function(){
  console.log('===== 1. 网易 url 接口：是不是直接返回音频流 =====');
  {
    const j = await (await req('https://api.qijieya.cn/meting/?type=search&id=' + encodeURIComponent(KW) + '&limit=3&server=netease')).json();
    for(const it of j.slice(0,2)){
      const id = (String(it.url||'').match(/[?&]id=(\d+)/)||[])[1];
      const api = 'https://api.qijieya.cn/meting/?server=netease&type=url&id=' + id;
      const r0 = await req(api, {method:'GET', headers:{'Range':'bytes=0-2047'}});
      console.log('  ' + it.name);
      console.log('    接口 GET (不跟随前的响应) status=' + r0.status +
        ' content-type=' + (r0.headers.get('content-type')||'') +
        ' content-length=' + (r0.headers.get('content-length')||''));
      const p = await probe(api);
      console.log('    最终 ' + p.status + ' ' + p.type + ' 总大小 ' + (p.total/1048576).toFixed(2) + 'MB');
      console.log('    实际地址 ' + p.final);
    }
  }

  console.log('');
  console.log('===== 2. QQ tang 详情：字段全貌（关键词 ' + KW + '）=====');
  async function dumpTang(kw){
    const s = await (await req('https://tang.api.s01s.cn/music_open_api.php?msg=' + encodeURIComponent(kw) + '&type=json', {}, 10000)).json();
    const arr = Array.isArray(s) ? s : (s && s.data) || [];
    console.log('  搜索 ' + arr.length + ' 条');
    for(const it of arr.slice(0,3)){
      const mid = it.song_mid;
      if(!mid) continue;
      const d = await (await req('https://tang.api.s01s.cn/music_open_api.php?msg=' + encodeURIComponent(kw) +
        '&type=json&mid=' + encodeURIComponent(mid), {}, 12000)).json().catch(e => ({_err:e.message}));
      const keys = Object.keys(d || {});
      const urlKeys = keys.filter(k => /play_url|song_play|url/i.test(k));
      console.log('  ---- ' + (it.song_title || it.title) + ' / ' + (it.singer_name||'') + '  mid=' + mid);
      console.log('      pay=' + JSON.stringify(it.pay) + '  返回字段数=' + keys.length);
      console.log('      含 url 的字段: ' + (urlKeys.length ? urlKeys.join(', ') : '（无）'));
      urlKeys.forEach(k => { console.log('        ' + k + ' = ' + String(d[k]).slice(0, 100)); });
      console.log('      vip=' + JSON.stringify(d.vip) + ' song_play_time=' + d.song_play_time);
      // 看整个返回体前 400 字符，确认有没有被截断到别的结构
      if(!urlKeys.length){
        console.log('      返回体: ' + JSON.stringify(d).slice(0, 400));
      }
    }
  }
  await dumpTang(KW);
  console.log('');
  console.log('===== 2b. 换关键字再试（' + KW2 + '）=====');
  await dumpTang(KW2);

  console.log('');
  console.log('===== 3. 酷我歌词 127B 内容 =====');
  {
    const j = await (await req('https://oiapi.net/api/Kuwo?msg=' + encodeURIComponent(KW) + '&page=1&limit=3')).json();
    const arr = (j && j.data) || [];
    for(let i=0;i<2;i++){
      const it = arr[i]; if(!it) continue;
      const dj = await (await req('https://oiapi.net/api/Kuwo?msg=' + encodeURIComponent(KW) + '&n=' + (i+1) + '&br=1')).json();
      const d = dj && dj.data;
      const rid = String((d && d.rid) || it.rid || '').replace(/^MUSIC_/i,'');
      const r = await req('https://m.kuwo.cn/newh5/singles/songinfoandlrc?musicId=' + rid);
      const t = await r.text();
      console.log('  ' + it.song + '  rid=' + rid + ' status=' + r.status + ' len=' + t.length);
      console.log('      ' + t.replace(/\s+/g,' ').slice(0, 200));
    }
  }
})();
