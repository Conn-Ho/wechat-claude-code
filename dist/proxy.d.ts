/**
 * 代理支持 — 检测 HTTPS_PROXY/HTTP_PROXY 环境变量，设置全局 fetch dispatcher
 * 在入口文件最先导入，确保所有 fetch 调用都走代理
 */
export {};
