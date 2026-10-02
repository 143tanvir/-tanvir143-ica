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
  private cursor?: string;

  @Expose()
  private seqId?: number;

  set state(body: DirectInboxFeedResponse) {
    this.moreAvailable = Boolean(body?.inbox?.has_older);

    this.seqId =
      typeof body?.seq_id === 'number'
        ? body.seq_id
        : undefined;

    this.cursor =
      body?.inbox?.oldest_cursor || undefined;
  }

  async request(): Promise<DirectInboxFeedResponse> {
    const isPaging = Boolean(this.cursor);

    const requestTrackingId =
      typeof this.client.state.uuid === 'string'
        ? this.client.state.uuid
        : undefined;

    const qs: Record<string, any> = {
      eb_device_id: '0',

      igd_request_log_tracking_id:
        requestTrackingId,

      visual_message_return_type: 'unseen',

      thread_message_limit: 10,

      persistentBadging: true,

      limit: 20,

      is_prefetching: false,

      fetch_reason: isPaging
        ? 'page_scroll'
        : 'initial_snapshot',

      include_old_mrs: false,

      no_pending_badge: true,

      push_disabled: false,
    };

    if (this.cursor) {
      qs.cursor = this.cursor;
      qs.direction = 'older';
    }

    const { body } =
      await this.client.request.send<DirectInboxFeedResponse>({
        url: '/api/v1/direct_v2/inbox/',
        qs,
      });

    if (!body || !body.inbox) {
      throw new Error(
        'Instagram Direct inbox returned an invalid response'
      );
    }

    if (
      body.seq_id === undefined ||
      body.snapshot_at_ms === undefined
    ) {
      throw new Error(
        'Instagram Direct inbox response did not contain realtime sync state'
      );
    }

    this.state = body;

    return body;
  }

  async items(): Promise<
    DirectInboxFeedResponseThreadsItem[]
  > {
    const response = await this.request();

    return response.inbox.threads || [];
  }

  async records(): Promise<DirectThreadEntity[]> {
    const threads = await this.items();

    return threads.map(thread =>
      this.client.entity.directThread(
        thread.thread_id
      )
    );
  }
}
