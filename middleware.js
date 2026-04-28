export const config = {
  // 匹配所有路径
  matcher: '/(.*)',
};

export default async function middleware(req) {
  const basicAuth = req.headers.get('authorization');

  if (basicAuth) {
    try {
      const authValue = basicAuth.split(' ')[1];
      const decodedValue = atob(authValue);
      const index = decodedValue.indexOf(':');
      const user = decodedValue.substring(0, index);
      const inputPwd = decodedValue.substring(index + 1);

      // 从 Vercel 环境变量获取 Upstash 的接口地址和 Token
      const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
      const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;

      // 👇 【核心修改点】：适配你的 Key 格式：u:用户名:pwd
      const redisKey = `u:${user}:pwd`;
      const apiUrl = `${upstashUrl}/get/${redisKey}`;
      
      const response = await fetch(apiUrl, {
        headers: {
          'Authorization': `Bearer ${upstashToken}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        // Upstash 会把查到的纯文本放在 result 字段中
        const realPwd = data.result;

        // 对比：确保账号存在(不为null) 且 用户输入的密码与数据库明文密码完全一致
        if (realPwd !== null && inputPwd === String(realPwd)) {
          return; // 验证通过，放行加载网页
        }
      }
    } catch (error) {
      console.error("Auth or Upstash Error");
    }
  }

  // 密码错误、账号不存在或未输入时弹窗
  return new Response('Auth required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Secure Area"',
    },
  });
}