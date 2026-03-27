export interface WhitelistRule {
    id: number;
    type: 'allow' | 'deny';
    tool: string;
    pattern?: string;
    createdAt: string;
}
export declare function loadRules(): WhitelistRule[];
export declare function addRule(type: 'allow' | 'deny', tool: string, pattern?: string): WhitelistRule;
export declare function removeRule(id: number): boolean;
export declare function clearRules(): void;
/** 检查工具调用是否匹配白名单，返回 'allow' | 'deny' | 'ask' */
export declare function checkRule(toolName: string, toolInput: Record<string, unknown>): 'allow' | 'deny' | 'ask';
export declare function formatRules(): string;
