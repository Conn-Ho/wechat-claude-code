/**
 * 文本处理工具 — Markdown 清理 + 分段
 */
/** 去除 Markdown 格式，转为微信纯文本 */
export declare function stripMarkdown(text: string): string;
/** 将长文本分段（微信限制约 4000 字符） */
export declare function chunkText(text: string, maxLen?: number): string[];
