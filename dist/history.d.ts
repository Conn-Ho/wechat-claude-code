export interface HistoryEntry {
    id: number;
    timestamp: string;
    userId: string;
    message: string;
    summary?: string;
}
export declare function loadHistory(): HistoryEntry[];
export declare function addHistory(userId: string, message: string): number;
export declare function updateSummary(id: number, summary: string): void;
/** 获取第 n 条历史（1 = 最新） */
export declare function getEntry(n: number): HistoryEntry | null;
export declare function formatHistory(): string;
