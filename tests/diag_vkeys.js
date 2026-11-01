/* 确认三件事：
   A) vkeys 对「付费」曲目是否恒定只给 60 秒试听（960887B），有没有别的参数能拿完整版
   B) 网易是否存在版权/付费限制（抽样更多关键词，看有没有拿不到 url 的）
   C) Joox br=4 是不是总是返回 FLAC 无损（网页端流式首帧会慢） */
const fs = require('fs');
function toHttps(u){ return String(u || '').replace(/^http:\/\//i, 'https://'); }
async function req(url, extra, ms){
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms || 12000);
  try{
    return await fetch(url, Object.assign({redirect:'follow', signal:ctrl.signal,
      headers:{'User-Agent':'Mozilla/5.0','Referer':'https://y.qq.com/'}}, extra || {}));
  }finally{ clearTimeout(t); }
}
async function size(url, ms){
  try{
    const r = await req(url, {method:'GET', headers:{'Range':'bytes=0-2047'}}, ms || 15000);
    const rg = r.headers.get('content-range') || '';
    const m = rg.match(/\/(\d+)\s*$/);
    return {s:r.status, total:m?parseInt(m[1],10):0, type:r.headers.get('content-type')||''};
  }catch(e){ return {s:0, total:0, err:e.name==='AbortError'?'TIMEOUT':e.message}; }
}
const j = (r) => r.json();

(async function(){
  console.log('===== A. vkeys 对付费曲目 =====');
  // 付费：晴天 0039MnYb0qxYhV / 免费：孤勇者童声版 001dZQEk1GKV6U
  const cases = [
    ['晴天(付费)', '0039MnYb0qxYhV'],
    ['发如雪(付费)', '0027oMO61wWi55'],
    ['孤勇者童声版(免费)', '001dZQEk1GKV6U']
  ];
  for(const [name, mid] of cases){
    const r = await req('https://api.vkeys.cn/v2/music/tencent?mid=' + encodeURIComponent(mid), {}, 10000);
    const b = await j(r);
    if(!b || b.code !== 200){ console.log('  ' + name + '  code=' + (b && b.code) + ' msg=' + (b && b.msg)); continue; }
    const d = b.data;
    console.log('  ' + name + '  ' + d.song + ' / ' + d.singer);
    console.log('      quality=' + d.quality + ' kbps=' + d.kbps + ' pay=' + JSON.stringify(d.pay) + ' time_len=' + JSON.stringify(d.time_len || d.timelen || null));
    console.log('      url=' + String(d.url).slice(0, 78));
    const p = await size(toHttps(d.url));
    console.log('      实测 ' + p.s + ' ' + (p.total/1048576).toFixed(2) + 'MB ' + p.type +
      (p.total === 960887 ? '  ⚠ 固定的 60s 试听片段' : '  （非试听）'));
    console.log('      返回体字段: ' + Object.keys(d).join(', '));
  }

  console.log('');
  console.log('===== B. 网易是否有限制（多关键词抽样，每词取 6 首）=====');
  const kws = ['周杰伦', '孤勇者', '陈奕迅', 'Taylor Swift', '薛之谦'];
  let miss = 0, ok = 0, small = 0;
  const misses = [];
  for(const kw of kws){
    const arr = await j(await req('https://api.qijieya.cn/meting/?type=search&id=' + encodeURIComponent(kw) + '&limit=6&server=netease', {}, 12000)).catch(()=>[]);
    for(const it of (arr || []).slice(0, 6)){
      const id = (String(it.url||'').match(/[?&]id=(\d+)/)||[])[1];
      if(!id){ misses.push(kw + ' / ' + it.name + '（无 id）'); miss++; continue; }
      const api = 'https://api.qijieya.cn/meting/?server=netease&type=url&id=' + id;
      const p = await size(api, 15000);
      if(p.total >= 1024*1024){ ok++; if(p.total < 3*1024*1024) { small++; console.log('    ⚠ 偏小: ' + it.name + ' ' + (p.total/1048576).toFixed(2) + 'MB'); } }
      else { miss++; misses.push(kw + ' / ' + it.name + ' → ' + (p.err || ('HTTP ' + p.s + ' ' + p.total + 'B'))); }
    }
  }
  console.log('  可播放 ' + ok + ' 首，异常 ' + miss + ' 首');
  misses.slice(0, 12).forEach(m => console.log('    ✗ ' + m));

  console.log('');
  console.log('===== C. Joox 各音质档位体积（br=4 是不是总给 FLAC）=====');
  {
    const s = await j(await req('https://apicx.asia/api/joox_music?msg=' + encodeURIComponent('孤勇者') + '&token=f84ao9lMF_q7husBWRfgUw&br=4', {}, 12000));
    const songs = (s && s.code === 200 && s.data && s.data.songs) ? s.data.songs : [];
    console.log('  搜索 ' + songs.length + ' 条');
    for(let i=0;i<2;i++){
      const it = songs[i]; if(!it) continue;
      const dd = await j(await req('https://apicx.asia/api/joox_music?msg=' + encodeURIComponent('孤勇者') + '&n=' + (i+1) + '&token=f84ao9lMF_q7husBWRfgUw&br=4', {}, 12000));
      const links = (dd && dd.data) ? (dd.data['播放链接'] || {}) : {};
      const names = Object.keys(links);
      console.log('  ' + (it['歌曲名称']||'') + '  可用档位: ' + names.join(' / '));
      for(const n of ['MP3 128','MP3 320','OGG 320','无损FLAC']){
        if(!links[n]) continue;
        const p = await size(toHttps(links[n]), 15000);
        console.log('      ' + n + ' → ' + p.s + ' ' + (p.total/1048576).toFixed(2) + 'MB ' + p.type);
      }
    }
  }
})();
