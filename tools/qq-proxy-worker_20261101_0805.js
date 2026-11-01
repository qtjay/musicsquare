/* QQ 官方音源代理（Cloudflare Worker）
 * ------------------------------------------------------------------
 * 作用：u.y.qq.com 的官方接口不返回 Access-Control-Allow-Origin，
 *       纯前端页面直连会被浏览器拦下。这个 Worker 只做一件事——
 *       把这一种请求转发出去，并补上 CORS 头。
 *
 * 部署（Cloudflare Dashboard → Workers → 创建 → 粘贴本文件 → 部署）：
 *   部署完会拿到形如 https://qq-proxy.<你的账号>.workers.dev 的地址，
 *   填进 musicsquare 歌单管理页的「QQ 官方音源代理」输入框即可。
 *
 * 安全约束（别删）：
 *   - 只放行 u.y.qq.com 且路径以 /cgi-bin/ 开头，避免被当成通用代理滥用
 *   - 只允许 GET / POST
 *   - 10 秒超时
 *
 * 注意：即使走了官方接口，付费曲目的播放链接（CgiGetVkey 的 purl）依然为空，
 *       这是 QQ 侧的限制，洛雪音乐本身也绕不过去（它的 getMusicUrl 同样
 *       委托给自定义音源）。这个代理改善的是搜索与元数据的稳定性。
 */

const ALLOWED_HOST = 'u.y.qq.com';
const ALLOWED_PATH = /^\/cgi-bin\//;
const UPSTREAM_UA = 'QQMusic 14090508(android 12)';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400'
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS }
  });
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (request.method !== 'GET' && request.method !== 'POST') {
      return json({ error: 'method not allowed' }, 405);
    }

    const target = new URL(request.url).searchParams.get('url');
    if (!target) return json({ error: 'missing ?url=' }, 400);

    let t;
    try {
      t = new URL(target);
    } catch (e) {
      return json({ error: 'bad url' }, 400);
    }
    if (t.protocol !== 'https:' || t.hostname !== ALLOWED_HOST || !ALLOWED_PATH.test(t.pathname)) {
      return json({ error: 'host or path not allowed' }, 403);
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    try {
      const upstream = await fetch(t.toString(), {
        method: request.method,
        headers: { 'Content-Type': 'application/json', 'User-Agent': UPSTREAM_UA },
        body: request.method === 'POST' ? await request.text() : undefined,
        signal: ctrl.signal,
        redirect: 'follow'
      });
      const body = await upstream.text();
      const headers = { ...CORS };
      const ct = upstream.headers.get('content-type');
      if (ct) headers['Content-Type'] = ct;
      return new Response(body, { status: upstream.status, headers });
    } catch (e) {
      return json({ error: 'upstream failed: ' + (e.name || e.message) }, 502);
    } finally {
      clearTimeout(timer);
    }
  }
};
