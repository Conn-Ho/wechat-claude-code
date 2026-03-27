export interface ScheduledJob {
    id: string;
    type: 'once' | 'cron';
    schedule: string;
    task: string;
    userId: string;
    contextToken: string;
    createdAt: string;
    lastRun?: string;
    enabled: boolean;
}
export declare function loadJobs(): ScheduledJob[];
export declare function addJob(params: Omit<ScheduledJob, 'id' | 'createdAt' | 'enabled'>): ScheduledJob;
export declare function removeJob(id: string): boolean;
export declare function markJobRun(id: string): void;
/** 返回当前应该执行的任务 */
export declare function getDueJobs(): ScheduledJob[];
export declare function formatJobs(): string;
export declare function parseScheduleCommand(text: string): {
    type: 'once' | 'cron';
    schedule: string;
    task: string;
} | null;
