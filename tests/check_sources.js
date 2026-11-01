/* 音源健康检查：真实网络逐个打各个第三方接口，不做任何 mock。
   覆盖「搜索」与「详情/播放直链」两层，并对直链做 Range 下载验证。 */
const KW = process.argv[2] || '周杰伦';
const SAMPLE = 3;

function toHttps(u){ return String(u || '').replace(/^http:\/\//i, 'https://'); }

async function fetchJSON(url, ms){
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms || 12000);
  try{
    const r = await fetch(url, {signal:ctrl.signal, redirect:'follow',
      headers:{'User-Agent':'Mozilla/5.0','Accept':'application/json,*/*'}});
    if(!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  }finally{ clearTimeout(timer); }
}

/* Range 请求只读 2KB，总大小必须从 Content-Range: bytes 0-2047/<total> 读 */
async function probeAudio(url){
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try{
    const r = await fetch(url, {signal:ctrl.signal, redirect:'follow', method:'GET',
      headers:{'Range':'bytes=0-2047',
        'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Referer':'https://y.qq.com/'}});
    const len = r.headers.get('content-length');
    const range = r.headers.get('content-range') || '';
    const m = range.match(/\/(\d+)\s*$/);
    const total = m ? parseInt(m[1], 10) : (len ? parseInt(len, 10) : 0);
    return {status:r.status, type:r.headers.get('content-type') || '',
      total:total, got:parseInt(len || '0', 10)};
  }catch(e){
    return {error:e.name === 'AbortError' ? 'TIMEOUT' : e.message, status:0, total:0, got:0};
  }finally{ clearTimeout(timer); }
}

async function probeLrc(url){
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try{
    const r = await fetch(url, {signal:ctrl.signal, redirect:'follow'});
    const t = await r.text();
    return {status:r.status, len:t.length, hasTimeTag:/\[\d{1,3}:\d{1,2}/.test(t)};
  }catch(e){
    return {error:e.name === 'AbortError' ? 'TIMEOUT' : e.message, len:0};
  }finally{ clearTimeout(timer); }
}

const out = [];
function log(s){ console.log(s); out.push(s); }

/* ============ 搜索层 ============ */
async function checkSearch(){
  log('=== 搜索层（关键词：' + KW + '）===');
  const res = {};

  // 网易
  try{
    const t0 = Date.now();
    const j = await fetchJSON('https://api.qijieya.cn/meting/?type=search&id=' + encodeURIComponent(KW) + '&limit=10&server=netease', 12000);
    const arr = Array.isArray(j) ? j : [];
    res.netease = arr;
    log('  网易 meting   ' + (arr.length ? 'OK' : '空') + '  ' + arr.length + ' 条  ' + (Date.now()-t0) + 'ms');
    arr.slice(0,2).forEach(x => log('      · ' + x.name + ' — ' + x.artist));
  }catch(e){ log('  网易 meting   失败  ' + e.message); res.netease = []; }

  // QQ meting
  try{
    const t0 = Date.now();
    const j = await fetchJSON('https://api.qijieya.cn/meting/?type=search&id=' + encodeURIComponent(KW) + '&limit=10&server=tencent', 8000);
    const arr = Array.isArray(j) ? j : [];
    res.qqMeting = arr;
    log('  QQ meting    ' + (arr.length ? 'OK' : '空') + '  ' + arr.length + ' 条  ' + (Date.now()-t0) + 'ms');
  }catch(e){ log('  QQ meting    失败  ' + e.message); res.qqMeting = []; }

  // QQ tang
  try{
    const t0 = Date.now();
    const j = await fetchJSON('https://tang.api.s01s.cn/music_open_api.php?msg=' + encodeURIComponent(KW) + '&type=json', 8000);
    const arr = Array.isArray(j) ? j : (Array.isArray(j && j.data) ? j.data : []);
    res.qqTang = arr;
    log('  QQ tang      ' + (arr.length ? 'OK' : '空') + '  ' + arr.length + ' 条  ' + (Date.now()-t0) + 'ms');
  }catch(e){ log('  QQ tang      失败  ' + e.message); res.qqTang = []; }

  // 酷我
  try{
    const t0 = Date.now();
    const j = await fetchJSON('https://oiapi.net/api/Kuwo?msg=' + encodeURIComponent(KW) + '&page=1&limit=10', 12000);
    const arr = Array.isArray(j && j.data) ? j.data : [];
    res.kuwo = arr;
    log('  酷我 OIAPI   ' + (arr.length ? 'OK' : '空') + '  ' + arr.length + ' 条  ' + (Date.now()-t0) + 'ms');
    arr.slice(0,2).forEach(x => log('      · ' + x.song + ' — ' + x.singer));
  }catch(e){ log('  酷我 OIAPI   失败  ' + e.message); res.kuwo = []; }

  // Joox
  try{
    const t0 = Date.now();
    const j = await fetchJSON('https://apicx.asia/api/joox_music?msg=' + encodeURIComponent(KW) + '&token=f84ao9lMF_q7husBWRfgUw&br=4', 12000);
    const arr = (j && j.code === 200 && j.data && Array.isArray(j.data.songs)) ? j.data.songs : [];
    res.joox = arr;
    log('  Joox         ' + (arr.length ? 'OK' : '空') + '  ' + arr.length + ' 条  ' + (Date.now()-t0) + 'ms' + (j && j.code !== 200 ? '  code=' + j.code : ''));
  }catch(e){ log('  Joox         失败  ' + e.message); res.joox = []; }

  return res;
}

/* ============ 详情/直链层 ============ */
async function checkPlay(search){
  log('');
  log('=== 播放直链层（每源抽样 ' + SAMPLE + ' 首，Range 读取真实总大小）===');

  // ---- 网易 ----
  log('  [网易]');
  const ne = (search.netease || []).slice(0, SAMPLE);
  for(const it of ne){
    const id = (String(it.url || '').match(/[?&]id=(\d+)/) || [])[1];
    if(!id){ log('      · ' + it.name + '  ✗ 拿不到 songid'); continue; }
    const urlUrl = 'https://api.qijieya.cn/meting/?server=netease&type=url&id=' + id;
    try{
      const j = await fetchJSON(urlUrl, 12000);
      const u = j && j.url ? j.url : (typeof j === 'string' ? j : null);
      if(!u){
        log('      · ' + it.name + '  ✗ url 接口返回 ' + JSON.stringify(j).slice(0, 90));
      }else{
        const p = await probeAudio(toHttps(u));
        const mb = p.total ? (p.total / 1048576).toFixed(2) + 'MB' : '-';
        log('      · ' + it.name + '  直链 ' + (p.error ? '✗ ' + p.error : p.status + ' ' + mb) + '  ' + (u.split('/').pop() || '').slice(0, 40));
      }
    }catch(e){ log('      · ' + it.name + '  ✗ ' + e.message); }
    const lrcUrl = 'https://api.qijieya.cn/meting/?server=netease&type=lrc&id=' + id;
    try{
      const l = await probeLrc(lrcUrl);
      log('        歌词 ' + (l.error ? '✗ ' + l.error : l.status + ' ' + l.len + 'B ' + (l.hasTimeTag ? '有时间轴' : '无时间轴')));
    }catch(e){ log('        歌词 ✗ ' + e.message); }
  }

  // ---- QQ ----
  log('  [QQ]');
  const qqSrc = (search.qqMeting && search.qqMeting.length) ? search.qqMeting : search.qqTang;
  const qqList = (qqSrc || []).slice(0, SAMPLE);
  if(!qqList.length) log('      （搜索无结果，跳过）');
  for(const it of qqList){
    const mid = it.song_mid || (String(it.url || '').match(/[?&]id=([^&]+)/) || [])[1];
    const name = it.name || it.song_title || '(无名)';
    if(!mid){ log('      · ' + name + '  ✗ 拿不到 mid'); continue; }
    // tang 主源
    let tangOk = null;
    try{
      const d = await fetchJSON('https://tang.api.s01s.cn/music_open_api.php?msg=' + encodeURIComponent(KW) + '&type=json&mid=' + encodeURIComponent(mid), 12000);
      if(d && d.song_mid){
        const order = ['hq','standard','sq','pq','fq','accom'];
        let picked = null;
        for(const k of order){
          const u = d['song_play_url_' + k];
          if(u){ picked = {k:k, u:u, kb:(String(d['kbps_' + k] || '').match(/(\d+)/) || [])[1]}; break; }
        }
        if(picked){
          const p = await probeAudio(toHttps(picked.u));
          tangOk = p;
          const dur = parseFloat(d.song_play_time || 0);
          const kb = parseInt(picked.kb || '0', 10);
          const impliedSec = kb ? (p.total * 8) / (kb * 1000) : 0;
          log('      · ' + name + '  tang[' + picked.k + '] ' + (p.error ? '✗ ' + p.error : p.status + ' ' + (p.total/1048576).toFixed(2) + 'MB') +
            '  kb=' + picked.kb + ' 声明=' + dur + 's 推算=' + impliedSec.toFixed(0) + 's' +
            (p.total === 960887 ? '  ⚠ 疑似 60s 试听片段' : ''));
        }else{
          log('      · ' + name + '  tang 返回详情但无可用播放字段');
        }
      }else{
        log('      · ' + name + '  tang 无详情 ' + JSON.stringify(d).slice(0, 70));
      }
    }catch(e){ log('      · ' + name + '  tang ✗ ' + e.message); }
    // vkeys 兜底
    if(!tangOk || tangOk.error){
      try{
        const r = await fetchJSON('https://api.vkeys.cn/v2/music/tencent?mid=' + encodeURIComponent(mid), 8000);
        const d = (r && r.code === 200) ? r.data : null;
        if(d && d.url){
          const p = await probeAudio(toHttps(d.url));
          log('        兜底 vkeys ' + (p.error ? '✗ ' + p.error : p.status + ' ' + (p.total/1048576).toFixed(2) + 'MB') +
            (p.total === 960887 ? '  ⚠ 固定 60s 试听（960887B）' : ''));
        }else{
          log('        兜底 vkeys 无 url  code=' + (r && r.code));
        }
      }catch(e){ log('        兜底 vkeys ✗ ' + e.message); }
    }
  }

  // ---- 酷我 ----
  log('  [酷我]');
  const kw = (search.kuwo || []).slice(0, SAMPLE);
  if(!kw.length) log('      （搜索无结果，跳过）');
  for(let i = 0; i < kw.length; i++){
    const it = kw[i];
    const n = i + 1;
    try{
      const j = await fetchJSON('https://oiapi.net/api/Kuwo?msg=' + encodeURIComponent(KW) + '&n=' + n + '&br=1', 12000);
      const d = (j && j.data && !Array.isArray(j.data)) ? j.data : null;
      if(!d || !d.url){ log('      · ' + it.song + '  ✗ 详情无 url ' + JSON.stringify(j).slice(0, 80)); continue; }
      const p = await probeAudio(toHttps(d.url));
      log('      · ' + it.song + '  直链 ' + (p.error ? '✗ ' + p.error : p.status + ' ' + (p.total/1048576).toFixed(2) + 'MB') +
        '  br=' + d.bitrate + ' fmt=' + d.format);
      if(p.status === 410 || p.error){
        const j2 = await fetchJSON('https://oiapi.net/api/Kuwo?msg=' + encodeURIComponent(KW) + '&n=' + n + '&br=320kmp3', 12000).catch(() => null);
        const d2 = (j2 && j2.data && !Array.isArray(j2.data)) ? j2.data : null;
        if(d2 && d2.url){
          const p2 = await probeAudio(toHttps(d2.url));
          log('        降级 320kmp3 → ' + (p2.error ? '✗ ' + p2.error : p2.status + ' ' + (p2.total/1048576).toFixed(2) + 'MB'));
        }
      }
      const rid = String(d.rid || it.rid || '').replace(/^MUSIC_/i, '');
      if(/^\d+$/.test(rid)){
        const l = await probeLrc('https://m.kuwo.cn/newh5/singles/songinfoandlrc?musicId=' + rid);
        log('        歌词 ' + (l.error ? '✗ ' + l.error : l.status + ' ' + l.len + 'B'));
      }
    }catch(e){ log('      · ' + it.song + '  ✗ ' + e.message); }
  }

  // ---- Joox ----
  log('  [Joox]');
  const jx = (search.joox || []).slice(0, SAMPLE);
  if(!jx.length) log('      （搜索无结果，跳过）');
  for(let i = 0; i < jx.length; i++){
    const it = jx[i];
    const n = i + 1;
    try{
      const j = await fetchJSON('https://apicx.asia/api/joox_music?msg=' + encodeURIComponent(KW) + '&n=' + n + '&token=f84ao9lMF_q7husBWRfgUw&br=4', 12000);
      if(!j || j.code !== 200 || !j.data){ log('      · ' + (it['歌曲名称'] || it.songmid) + '  ✗ 详情 code=' + (j && j.code)); continue; }
      const links = j.data['播放链接'] || {};
      const order = ['无损FLAC','Hi-Res无损','母带无损','OGG 320','MP3 320','AAC 192','OGG 192','MP3 128','AAC 96','AAC 48'];
      let picked = null;
      for(const k of order){ if(links[k]){ picked = {k:k, u:links[k]}; break; } }
      if(!picked){ log('      · ' + (it['歌曲名称'] || it.songmid) + '  ✗ 无播放链接字段'); continue; }
      const p = await probeAudio(toHttps(picked.u));
      log('      · ' + (it['歌曲名称'] || it.songmid) + '  [' + picked.k + '] ' +
        (p.error ? '✗ ' + p.error : p.status + ' ' + (p.total/1048576).toFixed(2) + 'MB'));
    }catch(e){ log('      · ' + (it['歌曲名称'] || it.songmid) + '  ✗ ' + e.message); }
  }
}

(async function(){
  log('音源健康检查  ' + new Date().toLocaleString('zh-CN'));
  log('');
  const search = await checkSearch();
  await checkPlay(search);
  log('');
  log('=== 结论说明 ===');
  log('· 直链大小用 Range: bytes=0-2047 + Content-Range 读取总长，不是下载量');
  log('· 960887 bytes 是 vkeys QQ 接口固定返回的 60 秒试听片段特征长度');
  log('· 推算秒数 = 总字节 × 8 ÷ (kbps × 1000)，与接口声明时长对比可判断是否被截断');
})();
