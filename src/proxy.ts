/**
 * 代理支持 — 检测 HTTPS_PROXY/HTTP_PROXY 环境变量，设置全局 fetch dispatcher
 * 在入口文件最先导入，确保所有 fetch 调用都走代理
 */

const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy
  || process.env.HTTP_PROXY || process.env.http_proxy;

if (proxyUrl) {
  try {
    // Node.js 22+ 内置 undici ProxyAgent
    // @ts-ignore — undici 内置于 Node.js 22+ 但无独立类型声明
    const { ProxyAgent, setGlobalDispatcher } = await import('undici');
    setGlobalDispatcher(new ProxyAgent(proxyUrl));
    process.stderr.write(`[wechat-channel] 使用代理: ${proxyUrl}\n`);
  } catch {
    process.stderr.write(`[wechat-channel] 警告: 设置代理失败，将直连\n`);
  }
}
