import { Expose } from 'class-transformer';
import { Feed } from '../core/feed';
import {
  DirectInboxFeedResponse,
  DirectInboxFeedResponseThreadsItem,
} from '../responses';
import { DirectThreadEntity } from '../entities';

export class DirectInboxFeed extends Feed<
  DirectInboxFeedResponse,
  DirectInboxFeedResponseThreadsItem
> {
  @Expose()
  private cursor: string;

  set state(body: DirectInboxFeedResponse) {
    this.moreAvailable = body.inbox.has_older;
    this.cursor = body.inbox.oldest_cursor;
  }

  async request() {
    const trackingId =
      typeof (this.client as any).generateUuid === 'function'
        ? (this.client as any).generateUuid()
        : this.client.state.uuid;

    const params: Record<string, any> = {
      eb_device_id: '0',
      igd_request_log_tracking_id: trackingId,

      visual_message_return_type: 'unseen',
      thread_message_limit: 10,
      persistentBadging: true,
      limit: 20,

      // Instagram's current inbox bootstrap request
      is_prefetching: false,
      fetch_reason: this.cursor ? 'page_scroll' : 'initial_snapshot',
      include_old_mrs: false,
      no_pending_badge: true,
      push_disabled: 'true',
    };

    if (this.cursor) {
      params.cursor = this.cursor;
      params.direction = 'older';
    }

    const { body } =
      await this.client.request.send<DirectInboxFeedResponse>({
        url: `/api/v1/direct_v2/inbox/`,
        qs: params,
      });

    this.state = body;
    return body;
  }

  async items() {
    const response = await this.request();
    return response.inbox.threads;
  }

  async records(): Promise<DirectThreadEntity[]> {
    const threads = await this.items();

    return threads.map(thread =>
      this.client.entity.directThread(thread.thread_id)
    );
  }
}
