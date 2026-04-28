export const config = {
  // 匹配所有路径，防止别人通过直接访问 /index.html 或其他静态文件绕过密码
  matcher: '/(.*)',
};

export default function middleware(req) {
  const basicAuth = req.headers.get('authorization');

  if (basicAuth) {
    try {
      const authValue = basicAuth.split(' ')[1];
      // 解码 Base64 格式的账号密码
      const decodedValue = atob(authValue);
      
      // 【修改点1】：使用 indexOf 分割，防止密码本身包含冒号导致解析错位
      const index = decodedValue.indexOf(':');
      const user = decodedValue.substring(0, index);
      const pwd = decodedValue.substring(index + 1);

      // 👇 在这里设置你的账号和密码 👇
      if (user === 'yygx' && pwd === 'yygx880919') {
        // 【修改点2】：验证通过时，直接 return（返回空）
        // 这是纯 Vercel 项目最标准的放行方式，告诉服务器直接加载原本的网页
        return; 
      }
    } catch (error) {
      // 如果浏览器传来的编码有问题导致 atob 崩溃，捕获错误，防止整个函数死机
      console.error("Auth error");
    }
  }

  // 如果没有输入密码、密码错误、或解析失败，弹出登录框
  return new Response('Auth required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Secure Area"',
    },
  });
}