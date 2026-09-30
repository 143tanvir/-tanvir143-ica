import { Repository } from '../core/repository';
export declare class DirectThreadInfoRepository extends Repository {
    getThreadInfo(threadId: string): Promise<any>;
    getThreadMessages(threadId: string, minSeqId?: number): Promise<any>;
}
