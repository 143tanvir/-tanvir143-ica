import { Feed } from '../core/feed';
import { UserFeedResponse, UserFeedResponseItemsItem } from '../responses';
export declare class UserFeed extends Feed<UserFeedResponse, UserFeedResponseItemsItem> {
    id: number | string;
    private nextMaxId;
    protected set state(body: UserFeedResponse);
    request(): Promise<import("../responses").UserFeedResponseRootObject>;
    items(): Promise<UserFeedResponseItemsItem[]>;
}
