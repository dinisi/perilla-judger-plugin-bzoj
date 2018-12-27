import { Number, Record, String } from "runtypes";
export declare enum SolutionResult {
    WaitingJudge = 0,
    Judging = 1,
    Skipped = 2,
    Accepted = 3,
    WrongAnswer = 4,
    TimeLimitExceeded = 5,
    MemoryLimitExceeded = 6,
    RuntimeError = 7,
    CompileError = 8,
    PresentationError = 9,
    JudgementFailed = 10,
    SystemError = 11,
    OtherError = 12
}
export interface IFileModel {
    id: number;
    name: string;
    type: string;
    description: string;
    hash: string;
    size: number;
    created: Date;
    tags: string[];
    owner: string;
    creator: string;
}
export interface ISolution {
    status: SolutionResult;
    score: number;
    details?: IDetails;
}
export declare type JudgeFunction = (problem: object, solution: object, resolveFile: (id: number) => Promise<{
    path: string;
    info: IFileModel;
}>, callback: (solution: ISolution) => Promise<void>) => Promise<void>;
export declare const Problem: Record<{
    id: Number;
}>;
export declare const Solution: Record<{
    file: Number;
    language: String;
}>;
export interface IDetails {
    time?: string;
    memory?: string;
    error?: string;
    submitTime?: string;
    remoteUser?: string;
    runID?: number;
}
