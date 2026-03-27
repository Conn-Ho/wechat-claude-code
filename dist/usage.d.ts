interface DayUsage {
    date: string;
    messagesSent: number;
    messagesReceived: number;
    estimatedTokens: number;
}
export declare function loadUsage(): Record<string, DayUsage>;
export declare function trackMessage(type: 'sent' | 'received', text: string): void;
export declare function formatUsage(): string;
export {};
