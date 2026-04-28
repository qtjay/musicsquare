export const config = {
  // 匹配所有路径
  matcher: '/',
};

export default function middleware(req) {
  const basicAuth = req.headers.get('authorization');
  const url = req.url;

  if (basicAuth) {
    const authValue = basicAuth.split(' ')[1];
    // 解码 base64 格式的账号密码
    const [user, pwd] = atob(authValue).split(':');

    // 👇 在这里设置你的账号和密码 👇
    if (user === 'yygx' && pwd === 'yygx80919') {
      return new Response(null, {
        headers: { 'x-middleware-next': '1' }
      });
    }
  }

  // 如果没有输入密码或密码错误，弹出登录框
  return new Response('Auth required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Secure Area"',
    },
  });
}