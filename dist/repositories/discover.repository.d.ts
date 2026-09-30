import { Repository } from '../core/repository';
import { DiscoverRepositoryChainingResponseRootObject } from '../responses/01/discover.repository.chaining.response';
export declare class DiscoverRepository extends Repository {
    chaining(targetId: string): Promise<DiscoverRepositoryChainingResponseRootObject>;
    topicalExplore(): Promise<any>;
    markSuSeen(): Promise<any>;
    profileSuBadge(): Promise<any>;
}
