/**
 * 文本处理工具 — Markdown 清理 + 分段
 */

/** 去除 Markdown 格式，转为微信纯文本 */
export function stripMarkdown(text: string): string {
  let result = text;
  // 代码围栏：去除 ``` 保留内容
  result = result.replace(/```[^\n]*\n?([\s\S]*?)```/g, (_, code: string) => code.trim());
  // 图片链接：移除
  result = result.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  // 链接：保留显示文字
  result = result.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  // 粗体
  result = result.replace(/\*\*(.+?)\*\*/g, '$1');
  result = result.replace(/__(.+?)__/g, '$1');
  // 斜体
  result = result.replace(/\*(.+?)\*/g, '$1');
  result = result.replace(/_(.+?)_/g, '$1');
  // 标题
  result = result.replace(/^#{1,6}\s+/gm, '');
  // 水平线
  result = result.replace(/^[-*_]{3,}$/gm, '');
  // 引用
  result = result.replace(/^>\s?/gm, '');
  return result.trim();
}

/** 将长文本分段（微信限制约 4000 字符） */
export function chunkText(text: string, maxLen = 3900): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    // 优先在双换行处分割
    let breakAt = remaining.lastIndexOf('\n\n', maxLen);
    if (breakAt < maxLen * 0.3) {
      // 其次单换行
      breakAt = remaining.lastIndexOf('\n', maxLen);
    }
    if (breakAt < maxLen * 0.3) {
      // 其次空格（避免截断 URL）
      breakAt = remaining.lastIndexOf(' ', maxLen);
    }
    if (breakAt < maxLen * 0.3) {
      breakAt = maxLen;
    }
    chunks.push(remaining.slice(0, breakAt));
    remaining = remaining.slice(breakAt).trimStart();
  }
  return chunks;
}
