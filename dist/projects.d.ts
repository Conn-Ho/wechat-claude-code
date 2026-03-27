export interface Project {
    name: string;
    dir: string;
    addedAt: string;
}
export declare function loadProjects(): Project[];
export declare function addProject(name: string, dir: string): boolean;
export declare function removeProject(name: string): boolean;
export declare function getActiveProject(): string | null;
export declare function setActiveProject(name: string): void;
export declare function findProject(name: string): Project | null;
export declare function formatProjects(): string;
