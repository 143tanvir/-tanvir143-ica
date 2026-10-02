/**
 * FCA-compatible adapter for InstaBot / GoatBot style consumers.
 *
 * This layer keeps the callback-first API expected by the original remote ICA
 * while using the local IgApiClient implementation underneath.
 *
 * It intentionally contains no remote-server transport: cookies/session state,
 * HTTP requests and realtime MQTT all run in the local Node.js process.
 */

import { IgApiClient } from './core/client';
import { CookieLoader } from './core/cookie-loader';
import { DirectInboxFeedResponseThreadsItem } from './responses/01/direct-inbox.feed.response';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import * as request from 'request-promise';
import { IgCheckpointError, IgLoginRequiredError, IgUserHasLoggedOutError } from './errors';

export const DEFAULT_LOGIN_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 12; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

async function validateWebSession(
  ig: IgApiClient,
  userAgent?: string | null
): Promise<{ userId: string; username?: string }> {
  const response: any = await request({
    method: 'GET',
    uri: 'https://www.instagram.com/',
    jar: ig.state.cookieJar,
    resolveWithFullResponse: true,
    simple: false,
    gzip: true,
    timeout: 30000,
    headers: {
      'User-Agent': userAgent || DEFAULT_LOGIN_USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: 'https://www.instagram.com/',
    },
  });

  const html = String(response?.body || '');
  const finalUrl = String(
    response?.request?.uri?.href ||
    response?.request?.href ||
    ''
  );

  if (response?.statusCode < 200 || response?.statusCode >= 400) {
    throw new Error(`Instagram web session check returned HTTP ${response?.statusCode}`);
  }

  // A redirect to the login page means the supplied session is not usable.
  if (
    /\/(?:accounts\/)?login(?:\/|$)/i.test(finalUrl) ||
    /<title[^>]*>\s*Instagram\s*\/\s*Login\s*<\/title>/i.test(html)
  ) {
    throw new Error('Instagram session is not authenticated');
  }

  const username =
    html.match(/\"username\":\"([^\"]+)\"/)?.[1] ||
    html.match(/\"alternateName\":\"@?([^\"]+)\"/)?.[1];

  let userId =
    html.match(/\"(?:user_id|profilePage_\w*id)\":\"?(\d+)\"?/)?.[1] ||
    '';

  if (!userId) {
    try {
      userId = String(ig.state.cookieUserId || '');
    } catch (_) {
      userId = '';
    }
  }

  if (!userId) {
    throw new Error('Instagram web session did not expose an authenticated user id');
  }

  return { userId, username };
}

export const METHODS = [
  // Original InstaBot/ICA compatibility surface
  'getUserInfo',
  'getThreadInfo',
  'getThreadList',
  'getThreadHistory',
  'sendMessage',
  'sendImage',
  'sendAudio',
  'sendVideo',
  'sendTextEffect',
  'sendAvatarTextEffect',
  'sendMusic',
  'musicSearch',
  'sendTypingIndicator',
  'stopTypingIndicator',
  'setMessageReaction',
  'unsendMessage',
  'deleteMessage',
  'markAsRead',
  'markAsDelivered',
  'setTitle',
  'addUserToThread',
  'removeUserFromThread',
  'changeThreadMute',
  'changeBio',
  'changeProfilePicture',
  'changeAvatar',
  'getAppState',
  'setOptions',
  'logout',

  // Local ICA additions / realtime helpers used by the bot and advanced clients
  'getCurrentUserID',
  'listenMqtt',
  'listen',
  'setBiography',
  'removeMessageReaction',
  'createGroupThread',
  'getPresence',
  'hideThread',
  'leaveThread'
] as const;

type Callback<T> = (
  error: Error | null,
  result?: T
) => void;

interface LoginOptions {
  appState?: any;
  cookies?: any;
  cookieFile?: string;
  username?: string;
  password?: string;
  proxy?: string | null;
  userAgent?: string | null;
  appUserAgent?: string | null;
  listenEvents?: boolean;
  selfListen?: boolean;
  autoMarkRead?: boolean;
  autoMarkDelivery?: boolean;
  autoReconnect?: boolean;
  [key: string]: any;
}

function nodeify<T>(
  promise: Promise<T>,
  cb?: Function
): Promise<T> | void {
  if (typeof cb === 'function') {
    promise.then(
      value => cb(null, value),
      error => cb(error)
    );
    return;
  }

  return promise;
}

function sourceToBuffer(
  source: any
): Promise<Buffer> {
  if (Buffer.isBuffer(source)) {
    return Promise.resolve(source);
  }

  if (source == null) {
    return Promise.reject(
      new Error('Media source is required')
    );
  }

  if (
    source &&
    Buffer.isBuffer(source.buffer)
  ) {
    return Promise.resolve(source.buffer);
  }

  if (
    source &&
    typeof source.path === 'string'
  ) {
    return fs.promises.readFile(
      source.path
    );
  }

  if (typeof source === 'string') {
    if (/^https?:\/\//i.test(source)) {
      return downloadBuffer(source);
    }

    return fs.promises.readFile(source);
  }

  if (
    source &&
    typeof source.pipe === 'function'
  ) {
    return new Promise(
      (resolve, reject) => {
        const chunks: Buffer[] = [];

        source.on(
          'data',
          (chunk: Buffer | string) => {
            chunks.push(
              Buffer.isBuffer(chunk)
                ? chunk
                : Buffer.from(chunk)
            );
          }
        );

        source.on(
          'end',
          () => {
            resolve(
              Buffer.concat(chunks)
            );
          }
        );

        source.on(
          'error',
          reject
        );
      }
    );
  }

  return Promise.reject(
    new Error(
      'Unsupported media source. Use a Buffer, path, URL or readable stream.'
    )
  );
}

function normalizeBroadcastResult(
  result: any,
  fallbackThreadID: string
): {
  messageID: string;
  threadID: string;
  _raw: any;
} {
  const payload =
    result?.payload ?? result;

  const metadata =
    Array.isArray(
      result?.message_metadata
    )
      ? result.message_metadata[0]
      : undefined;

  return {
    messageID: String(
      payload?.item_id ??
      payload?.message_id ??
      metadata?.item_id ??
      metadata?.message_id ??
      ''
    ),

    threadID: String(
      payload?.thread_id ??
      metadata?.thread_id ??
      fallbackThreadID
    ),

    _raw: result
  };
}

function downloadBuffer(
  address: string
): Promise<Buffer> {
  return new Promise(
    (resolve, reject) => {
      const url = new URL(address);

      const transport =
        url.protocol === 'https:'
          ? https
          : http;

      const req = transport.get(
        url,
        response => {
          if (
            response.statusCode &&
            response.statusCode >= 300 &&
            response.statusCode < 400 &&
            response.headers.location
          ) {
            response.resume();

            return downloadBuffer(
              new URL(
                response.headers.location,
                url
              ).toString()
            ).then(
              resolve,
              reject
            );
          }

          if (
            !response.statusCode ||
            response.statusCode < 200 ||
            response.statusCode >= 300
          ) {
            response.resume();

            return reject(
              new Error(
                `Media download failed with HTTP ${
                  response.statusCode || 0
                }`
              )
            );
          }

          const chunks: Buffer[] = [];

          response.on(
            'data',
            (chunk: Buffer) => {
              chunks.push(chunk);
            }
          );

          response.on(
            'end',
            () => {
              resolve(
                Buffer.concat(chunks)
              );
            }
          );

          response.on(
            'error',
            reject
          );
        }
      );

      req.on(
        'error',
        reject
      );
    }
  );
}

function normalizeUser(
  user: any
): any {
  if (!user) {
    return null;
  }

  return {
    userID: String(
      user.pk ||
      user.user_id ||
      user.id ||
      ''
    ),

    name:
      user.full_name ||
      user.name ||
      user.first_name ||
      user.username ||
      '',

    firstName:
      user.first_name ||
      (
        user.full_name
          ? String(
              user.full_name
            ).split(/\s+/)[0]
          : user.username || ''
      ),

    vanity:
      user.username ||
      user.vanity ||
      '',

    username:
      user.username ||
      user.vanity ||
      '',

    profileUrl:
      user.username
        ? `https://www.instagram.com/${user.username}/`
        : null,

    thumbSrc:
      user.profile_pic_url ||
      user.profilePicture ||
      user.hd_profile_pic_url_info?.url ||
      null,

    profilePicture:
      user.profile_pic_url ||
      user.profilePicture ||
      null,

    biography:
      user.biography ||
      '',

    followerCount:
      user.follower_count ??
      user.followerCount,

    followingCount:
      user.following_count ??
      user.followingCount,

    isPrivate:
      user.is_private ??
      user.isPrivate,

    isVerified:
      user.is_verified ??
      user.isVerified,

    _raw: user
  };
}

function normalizeItem(
  item: any,
  thread: any,
  botId?: string
): any {
  const itemId = String(
    item?.item_id ||
    item?.message_id ||
    item?.id ||
    ''
  );

  const senderID =
    item?.user_id != null
      ? String(item.user_id)
      : null;

  const type =
    item?.item_type ||
    item?.type ||
    'text';

  const body =
    item?.text != null
      ? String(item.text)
      : '';

  const attachments: any[] = [];

  const media =
    item?.visual_media?.media ||
    item?.media ||
    item?.clip ||
    item?.reel_share?.media;

  if (media) {
    const mediaUrl =
      media?.image_versions2?.candidates?.[0]?.url ||
      media?.video_versions?.[0]?.url ||
      media?.thumbnail_url;

    if (mediaUrl) {
      attachments.push({
        type: /video/i.test(type)
          ? 'video'
          : /audio|voice/i.test(type)
          ? 'audio'
          : 'photo',

        url: mediaUrl,

        _raw: media
      });
    }
  }

  return {
    messageID: itemId,

    itemID: itemId,

    senderID,

    userID: senderID,

    threadID: String(
      thread?.thread_id ||
      thread?.thread_v2_id ||
      ''
    ),

    body,

    attachments,

    timestamp: Number(
      item?.timestamp ||
      item?.timestamp_ms ||
      Date.now()
    ),

    type:
      senderID &&
      botId &&
      senderID === botId
        ? 'message'
        : 'message',

    isGroup: !!(
      thread?.is_group ||
      thread?.isGroup ||
      thread?.thread_type === 'group'
    ),

    participantIDs:
      Array.isArray(thread?.users)
        ? thread.users.map(
            (u: any) =>
              String(u.pk)
          )
        : [],

    _raw: item
  };
}

function normalizeThread(
  thread:
    | DirectInboxFeedResponseThreadsItem
    | any
): any {
  const users =
    Array.isArray(thread?.users)
      ? thread.users
      : [];

  const participantIDs =
    users
      .map(
        (u: any) =>
          String(u.pk)
      )
      .filter(Boolean);

  const lastItem =
    thread?.last_permanent_item ||
    thread?.items?.[0] ||
    null;

  return {
    threadID: String(
      thread?.thread_id ||
      thread?.thread_v2_id ||
      ''
    ),

    threadName:
      thread?.thread_title ||
      thread?.name ||
      thread?.title ||
      users
        .map(
          (u: any) =>
            u.username
        )
        .filter(Boolean)
        .join(', '),

    name:
      thread?.thread_title ||
      thread?.name ||
      thread?.title ||
      users
        .map(
          (u: any) =>
            u.username
        )
        .filter(Boolean)
        .join(', '),

    participantIDs,

    participants:
      users
        .map(normalizeUser)
        .filter(Boolean),

    isGroup: !!(
      thread?.is_group ||
      thread?.isGroup ||
      participantIDs.length > 2 ||
      thread?.thread_type === 'group'
    ),

    threadType:
      thread?.thread_type,

    muted:
      !!thread?.muted,

    messageCount:
      Array.isArray(
        thread?.items
      )
        ? thread.items.length
        : undefined,

    lastMessage:
      lastItem
        ? normalizeItem(
            lastItem,
            thread
          )
        : null,

    _raw: thread
  };
}

function effectStyle(
  name: any
): number {
  const key =
    String(name || '')
      .toLowerCase();

  const map: Record<
    string,
    number
  > = {
    love: 1,
    gift: 2,
    celebration: 3,
    fire: 4
  };

  if (map[key]) {
    return map[key];
  }

  const n = Number(name);

  return Number.isFinite(n)
    ? n
    : 1;
}

export class FcaInstagramApi {
  public readonly client: IgApiClient;

  public _userID: string | null =
    null;

  private options: LoginOptions;

  private mqttStarted =
    false;

  private mqttHandlers: Function[] =
    [];

  private appStateCache: any[] =
    [];

  constructor(
    client: IgApiClient,
    options: LoginOptions = {}
  ) {
    this.client = client;

    this.options = options;
  }

  getCurrentUserID():
    string | null {
    try {
      return (
        this._userID ||
        this.client.state.cookieUserId ||
        null
      );
    } catch (_) {
      return this._userID;
    }
  }

  async getUserInfo(
    userIDs:
      | string
      | number
      | Array<
          string | number
        >,
    cb?: Callback<any>
  ): Promise<any> {
    const ids =
      Array.isArray(userIDs)
        ? userIDs
        : [userIDs];

    const entries:
      Record<string, any> = {};

    for (const id of ids) {
      const key = String(id);

      let user: any;

      if (/^\d+$/.test(key)) {
        user =
          await this.client.user.info(
            key
          );
      } else {
        user =
          await this.client.user.usernameinfo(
            key
          );
      }

      const normalized =
        normalizeUser(user);

      if (normalized) {
        entries[key] =
          normalized;
      }
    }

    return nodeify(
      Promise.resolve(entries),
      cb
    ) as any;
  }

  async getThreadList(
    limit = 20,
    _timestamp?: any,
    _tags: any[] = [],
    cb?: Callback<any>
  ): Promise<any[]> {
    const feed =
      this.client.feed.directInbox();

    const response: any =
      await feed.request();

    const threads =
      Array.isArray(
        response?.inbox?.threads
      )
        ? response.inbox.threads
        : [];

    return nodeify(
      Promise.resolve(
        threads
          .slice(
            0,
            Number(limit) || 20
          )
          .map(normalizeThread)
      ),
      cb
    ) as any;
  }

  async getThreadInfo(
    threadID: string,
    cb?: Callback<any>
  ): Promise<any> {
    const feed =
      this.client.feed.directThread({
        thread_id:
          String(threadID),

        oldest_cursor: ''
      });

    const response: any =
      await feed.request();

    const thread =
      response?.thread ||
      response?.inbox?.threads?.[0];

    const value =
      normalizeThread(
        thread || {
          thread_id:
            String(threadID)
        }
      );

    return nodeify(
      Promise.resolve(value),
      cb
    ) as any;
  }

  async getThreadHistory(
    threadID: string,
    amount = 50,
    _timestamp?: any,
    cb?: Callback<any>
  ): Promise<any[]> {
    const feed =
      this.client.feed.directThread({
        thread_id:
          String(threadID),

        oldest_cursor: ''
      });

    const response: any =
      await feed.request();

    const thread =
      response?.thread || {};

    const items =
      Array.isArray(thread.items)
        ? thread.items
        : [];

    const normalized =
      items
        .slice(
          0,
          Number(amount) || 50
        )
        .map(
          (item: any) =>
            normalizeItem(
              item,
              thread,
              this.getCurrentUserID() ||
                undefined
            )
        );

    return nodeify(
      Promise.resolve(
        normalized
      ),
      cb
    ) as any;
  }

  async sendMessage(
    message: any,
    threadID: string,
    cb?: Callback<any>,
    replyToMessage?: string
  ): Promise<any> {
    const payload =
      typeof message === 'string'
        ? message
        : String(
            message?.body ?? ''
          );

    const thread =
      this.client.entity.directThread(
        String(threadID)
      );

    const result: any =
      await thread.broadcastText(
        payload
      );

    const value = {
      messageID: String(
        result?.item_id ||
        result?.message_id ||
        result?.id ||
        result?.thread_id ||
        ''
      ),

      threadID: String(
        result?.thread_id ||
        threadID
      ),

      _raw: result,

      replyToMessageID:
        replyToMessage || null
    };

    return nodeify(
      Promise.resolve(value),
      cb
    ) as any;
  }

  async sendImage(
    source: any,
    threadID: string,
    _caption = '',
    cb?: Callback<any>,
    _replyToMessage?: string
  ): Promise<any> {
    const buffer =
      await sourceToBuffer(
        source
      );

    const result =
      await this.client.entity.directThread(
        String(threadID)
      ).broadcastPhoto({
        file: buffer
      });

    return nodeify(
      Promise.resolve(
        normalizeBroadcastResult(
          result,
          String(threadID)
        )
      ),
      cb
    ) as any;
  }

  async sendAudio(
    source: any,
    threadID: string,
    cb?: Callback<any>,
    _replyToMessage?: string
  ): Promise<any> {
    const buffer =
      await sourceToBuffer(
        source
      );

    const result =
      await this.client.entity.directThread(
        String(threadID)
      ).broadcastVoice({
        file: buffer
      });

    return nodeify(
      Promise.resolve(
        normalizeBroadcastResult(
          result,
          String(threadID)
        )
      ),
      cb
    ) as any;
  }

  async sendVideo(
    source: any,
    threadID: string,
    cb?: Callback<any>,
    _replyToMessage?: string
  ): Promise<any> {
    const buffer =
      await sourceToBuffer(
        source
      );

    const result =
      await this.client.entity.directThread(
        String(threadID)
      ).broadcastVideo({
        video: buffer
      });

    return nodeify(
      Promise.resolve(
        normalizeBroadcastResult(
          result,
          String(threadID)
        )
      ),
      cb
    ) as any;
  }

  async sendTextEffect(
    text: string,
    threadID: string,
    effect: any,
    cb?: Callback<any>
  ): Promise<any> {
    const response: any =
      await this.client.directThread.broadcast({
        item: 'text',

        threadIds:
          String(threadID),

        form: {
          text:
            String(text),

          power_up_data:
            JSON.stringify({
              style:
                effectStyle(effect)
            })
        }
      } as any);

    return nodeify(
      Promise.resolve(
        response?.payload ||
        response
      ),
      cb
    ) as any;
  }

  async sendAvatarTextEffect(
    text: string,
    threadID: string,
    effect: any,
    cb?: Callback<any>
  ): Promise<any> {
    const response: any =
      await this.client.directThread.broadcast({
        item: 'text',

        threadIds:
          String(threadID),

        form: {
          text:
            String(text),

          power_up_data:
            JSON.stringify({
              style:
                effectStyle(effect)
            })
        }
      } as any);

    return nodeify(
      Promise.resolve(
        response?.payload ||
        response
      ),
      cb
    ) as any;
  }

  async sendMusic(
    threadID: string,
    track: any,
    cb?: Callback<any>
  ): Promise<any> {
    const value =
      track &&
      typeof track === 'object'
        ? track
        : {
            id: String(track)
          };

    const form: any = {
      music_id:
        value.id ||
        value.pk ||
        value.music_id,

      track_id:
        value.track_id ||
        value.id ||
        value.pk,

      title:
        value.title ||
        value.name,

      artist:
        value.artist ||
        value.artist_name,

      cover_artwork_uri:
        value.cover_artwork_uri ||
        value.cover_artwork_url
    };

    const response: any =
      await this.client.directThread.broadcast({
        item: 'music',

        threadIds:
          String(threadID),

        form
      } as any);

    return nodeify(
      Promise.resolve(
        response?.payload ||
        response
      ),
      cb
    ) as any;
  }

  async musicSearch(
    query: string,
    cb?: Callback<any>
  ): Promise<any[]> {
    const feed =
      this.client.feed.musicSearch(
        String(query)
      );

    const items =
      await feed.items();

    return nodeify(
      Promise.resolve(items),
      cb
    ) as any;
  }

  sendTypingIndicator(
    threadID: string,
    cb?: Callback<any>
  ): any {
    const start =
      async () => {
        if (!this.mqttStarted) {
          await this.client.mqtt.connect();

          this.mqttStarted =
            true;
        }

        this.client.mqtt.sendTypingIndicator(
          String(threadID),
          true
        );

        return {
          threadID:
            String(threadID),

          typing: true
        };
      };

    const result =
      start();

    if (
      typeof cb === 'function'
    ) {
      result.then(
        v => cb(null, v),
        e => cb(e)
      );
    }

    return () =>
      this.stopTypingIndicator(
        threadID
      );
  }

  async stopTypingIndicator(
    threadID: string,
    cb?: Callback<any>
  ): Promise<any> {
    if (!this.mqttStarted) {
      return nodeify(
        Promise.resolve({
          threadID:
            String(threadID),

          typing: false
        }),
        cb
      ) as any;
    }

    this.client.mqtt.sendTypingIndicator(
      String(threadID),
      false
    );

    return nodeify(
      Promise.resolve({
        threadID:
          String(threadID),

        typing: false
      }),
      cb
    ) as any;
  }

  async setMessageReaction(
    reaction: string,
    messageID: string,
    threadID: string,
    cb?: Callback<any>
  ): Promise<any> {
    const emoji =
      reaction || '❤';

    const response: any =
      await this.client.directThread.broadcast({
        item: 'reaction',

        threadIds:
          String(threadID),

        form: {
          item_type:
            'reaction',

          reaction_type:
            'like',

          reaction_status:
            'created',

          node_type:
            'item',

          item_id:
            String(messageID),

          emoji,

          reaction_action_source:
            'double_tap',

          send_attribution:
            'message_reaction'
        }
      } as any);

    return nodeify(
      Promise.resolve(
        response?.payload ||
        response
      ),
      cb
    ) as any;
  }

  async removeMessageReaction(
    reaction: string,
    messageID: string,
    threadID: string,
    cb?: Callback<any>
  ): Promise<any> {
    const emoji =
      reaction || '❤';

    const response: any =
      await this.client.directThread.broadcast({
        item: 'reaction',

        threadIds:
          String(threadID),

        form: {
          item_type:
            'reaction',

          reaction_type:
            'like',

          reaction_status:
            'deleted',

          node_type:
            'item',

          item_id:
            String(messageID),

          emoji,

          reaction_action_source:
            'double_tap',

          send_attribution:
            'message_reaction'
        }
      } as any);

    return nodeify(
      Promise.resolve(
        response?.payload ||
        response
      ),
      cb
    ) as any;
  }

  async unsendMessage(
    messageID: string,
    threadID: string,
    cb?: Callback<any>
  ): Promise<any> {
    const result =
      await this.client.directThread.deleteItem(
        String(threadID),
        String(messageID)
      );

    return nodeify(
      Promise.resolve(result),
      cb
    ) as any;
  }

  async deleteMessage(
    messageID: string,
    threadID: string,
    cb?: Callback<any>
  ): Promise<any> {
    return this.unsendMessage(
      messageID,
      threadID,
      cb
    );
  }

  async markAsRead(
    threadID: string,
    cb?: Callback<any>
  ): Promise<any> {
    const info: any =
      await this.getThreadInfo(
        String(threadID)
      );

    const itemID =
      info?.lastMessage?.messageID;

    if (!itemID) {
      return nodeify(
        Promise.resolve({
          status: 'ok',

          threadID:
            String(threadID),

          marked: false
        }),
        cb
      ) as any;
    }

    const result =
      await this.client.directThread.markItemSeen(
        String(threadID),
        String(itemID)
      );

    return nodeify(
      Promise.resolve(result),
      cb
    ) as any;
  }

  async markAsDelivered(
    threadID: string,
    cb?: Callback<any>
  ): Promise<any> {
    const result = {
      status:
        'unsupported',

      threadID:
        String(threadID),

      message:
        'Instagram private API client does not expose a separate delivered receipt endpoint.'
    };

    if (
      typeof cb === 'function'
    ) {
      cb(null, result);
    }

    return result;
  }

  async setTitle(
    title: string,
    threadID: string,
    cb?: Callback<any>
  ): Promise<any> {
    const result =
      await this.client.directThread.updateTitle(
        String(threadID),
        String(title)
      );

    return nodeify(
      Promise.resolve(result),
      cb
    ) as any;
  }

  async addUserToThread(
    userID:
      | string
      | number,
    threadID: string,
    cb?: Callback<any>
  ): Promise<any> {
    const result =
      await this.client.directThread.addUser(
        String(threadID),
        [String(userID)]
      );

    return nodeify(
      Promise.resolve(result),
      cb
    ) as any;
  }

  async removeUserFromThread(
    userID:
      | string
      | number,
    threadID: string,
    cb?: Callback<any>
  ): Promise<any> {
    const result =
      await this.client.directThread.removeUser(
        String(threadID),
        [String(userID)]
      );

    return nodeify(
      Promise.resolve(result),
      cb
    ) as any;
  }

  async changeThreadMute(
    mute: boolean,
    threadID: string,
    cb?: Callback<any>
  ): Promise<any> {
    const result =
      mute
        ? await this.client.directThread.mute(
            String(threadID)
          )
        : await this.client.directThread.unmute(
            String(threadID)
          );

    return nodeify(
      Promise.resolve(result),
      cb
    ) as any;
  }

  async changeBio(
    text: string,
    cb?: Callback<any>
  ): Promise<any> {
    const result =
      await this.client.account.setBiography(
        String(text)
      );

    return nodeify(
      Promise.resolve(result),
      cb
    ) as any;
  }

  async changeProfilePicture(
    source: any,
    cb?: Callback<any>
  ): Promise<any> {
    const buffer =
      await sourceToBuffer(source);

    const result =
      await this.client.account.changeProfilePicture(
        buffer
      );

    return nodeify(
      Promise.resolve(result),
      cb
    ) as any;
  }

  async changeAvatar(
    source: any,
    cb?: Callback<any>
  ): Promise<any> {
    // Instagram does not expose a separate avatar endpoint in this client.
    // Reuse profile-picture upload as the closest compatible operation.
    return this.changeProfilePicture(
      source,
      cb
    );
  }

  getAppState(): any[] {
    return this.appStateCache.slice();
  }

  setOptions(
    options: any = {},
    cb?: Callback<any>
  ): any {
    this.options = {
      ...this.options,
      ...options
    };

    if (
      options?.proxy !== undefined
    ) {
      this.client.state.proxyUrl =
        options.proxy || '';
    }

    // `userAgent` is reserved for browser-style web-session validation.
    // Keep MQTT on the native Instagram User-Agent unless an explicit
    // native appUserAgent override is provided.
    if (options?.appUserAgent) {
      this.client.state.appUserAgentOverride = String(options.appUserAgent);
    }

    const result =
      this.options;

    if (
      typeof cb === 'function'
    ) {
      cb(null, result);
    }

    return result;
  }

  async logout(
    cb?: Callback<any>
  ): Promise<any> {
    const result =
      await this.client.account.logout();

    return nodeify(
      Promise.resolve(result),
      cb
    ) as any;
  }

  async createGroupThread(
    recipientUsers:
      Array<string | number>,
    threadTitle: string,
    cb?: Callback<any>
  ): Promise<any> {
    const result =
      await this.client.direct.createGroupThread(
        recipientUsers.map(String),
        String(threadTitle)
      );

    return nodeify(
      Promise.resolve(result),
      cb
    ) as any;
  }

  async getPresence(
    cb?: Callback<any>
  ): Promise<any> {
    const result =
      await this.client.direct.getPresence();

    return nodeify(
      Promise.resolve(result),
      cb
    ) as any;
  }

  async hideThread(
    threadID: string,
    cb?: Callback<any>
  ): Promise<any> {
    const result =
      await this.client.directThread.hide(
        String(threadID)
      );

    return nodeify(
      Promise.resolve(result),
      cb
    ) as any;
  }

  async leaveThread(
    threadID: string,
    cb?: Callback<any>
  ): Promise<any> {
    const result =
      await this.client.directThread.leave(
        String(threadID)
      );

    return nodeify(
      Promise.resolve(result),
      cb
    ) as any;
  }

  async setBiography(
    text: string,
    cb?: Callback<any>
  ): Promise<any> {
    return this.changeBio(
      text,
      cb
    );
  }

  listenMqtt(
    cb: Function
  ): () => void {
    let stopped = false;

    const handlers =
      this.mqttHandlers;

    const onMessage =
      (data: any) => {
        if (stopped) {
          return;
        }

        const packets =
          Array.isArray(data)
            ? data
            : [data];

        for (
          const packet of packets
        ) {
          for (
            const message of
            extractEvents(
              packet,
              this.getCurrentUserID()
            )
          ) {
            cb(
              null,
              message
            );
          }
        }
      };

    this.client.mqtt.on(
      '/ig_message_sync',
      onMessage
    );

    this.client.mqtt.on(
      '/ig_send_message_response',
      onMessage
    );

    this.client.mqtt.on(
      '/ig_typing_indicator',
      onMessage
    );

    this.client.mqtt.on(
      '/pubsub',
      onMessage
    );

    handlers.push(
      onMessage
    );

    const connect =
      async () => {
        await this.client.mqtt.connect();

        this.mqttStarted =
          true;
      };

    connect().catch(
      error =>
        cb(error)
    );

    return () => {
      if (stopped) {
        return;
      }

      stopped = true;

      this.client.mqtt.off(
        '/ig_message_sync',
        onMessage
      );

      this.client.mqtt.off(
        '/ig_send_message_response',
        onMessage
      );

      this.client.mqtt.off(
        '/ig_typing_indicator',
        onMessage
      );

      this.client.mqtt.off(
        '/pubsub',
        onMessage
      );

      const index =
        handlers.indexOf(
          onMessage
        );

      if (index >= 0) {
        handlers.splice(
          index,
          1
        );
      }
    };
  }

  listen(
    cb: Function
  ): () => void {
    return this.listenMqtt(cb);
  }
}

function extractEvents(
  packet: any,
  botID: string | null
): any[] {
  const events: any[] = [];

  const threadIdFromPath = (value: any): string | null => {
    const path = String(value || '');
    const prefixes = [
      '/direct_v2/threads/',
      '/direct_v2/inbox/threads/'
    ];

    for (const prefix of prefixes) {
      if (path.startsWith(prefix)) {
        return path.slice(prefix.length).split('/', 1)[0] || null;
      }
    }

    return null;
  };

  const parseValue = (value: any): any => {
    if (typeof value !== 'string') {
      return value;
    }

    try {
      return JSON.parse(value);
    } catch (_) {
      return { value };
    }
  };

  const pushEvent = (
    raw: any,
    thread: any = {},
    deltaType?: any
  ): void => {
    if (!raw || typeof raw !== 'object') {
      return;
    }

    const mergedThread = {
      ...thread,
      thread_id:
        raw.thread_id ||
        thread.thread_id ||
        threadIdFromPath(raw.path) ||
        undefined,
      users:
        raw.users ||
        thread.users,
      is_group:
        raw.is_group ??
        thread.is_group
    };

    const hasMessageFields =
      raw.item_id != null ||
      raw.message_id != null ||
      raw.id != null ||
      raw.text != null ||
      raw.item_type != null ||
      raw.type != null;

    if (!hasMessageFields) {
      return;
    }

    const event = normalizeItem(
      raw,
      mergedThread,
      botID || undefined
    );

    const itemType = String(
      raw.item_type ||
      raw.type ||
      ''
    ).toLowerCase();

    const delta = String(
      deltaType ||
      raw.delta_type ||
      ''
    );

    if (
      /reaction/.test(itemType) ||
      /reaction/i.test(delta)
    ) {
      event.type = 'message_reaction';
    } else if (
      /unsend|delete/.test(itemType) ||
      /Unsend|Delete/i.test(delta)
    ) {
      event.type = 'message_unsend';
    } else {
      event.type = 'message';
    }

    events.push(event);
  };

  const walk = (
    value: any,
    inheritedThread: any = {},
    inheritedDelta?: any
  ): void => {
    if (!value) {
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item, inheritedThread, inheritedDelta);
      }
      return;
    }

    if (typeof value !== 'object') {
      return;
    }

    // Existing FCA-style delta wrapper.
    if (value.delta_type && value.message) {
      const raw =
        value.message && typeof value.message === 'object'
          ? value.message
          : parseValue(value.message);

      pushEvent(
        raw,
        {
          ...inheritedThread,
          thread_id:
            raw?.thread_id ||
            value.thread_id ||
            threadIdFromPath(raw?.path) ||
            inheritedThread.thread_id
        },
        value.delta_type
      );
      return;
    }

    // Current Instagram message-sync packets are shaped like:
    // [{ data: [{ path, op, value: "{...}" }] }].
    if (Array.isArray(value.data)) {
      const metaThread = {
        ...inheritedThread,
        thread_id:
          value.thread_id ||
          inheritedThread.thread_id
      };

      for (const patch of value.data) {
        if (!patch || typeof patch !== 'object') {
          continue;
        }

        if (
          patch.path &&
          Object.prototype.hasOwnProperty.call(
            patch,
            'value'
          )
        ) {
          const parsed = parseValue(patch.value);
          const threadID =
            parsed?.thread_id ||
            threadIdFromPath(patch.path) ||
            metaThread.thread_id;

          if (parsed && typeof parsed === 'object') {
            pushEvent(
              {
                ...parsed,
                thread_id: threadID
              },
              {
                ...metaThread,
                thread_id: threadID
              },
              parsed.delta_type
            );

            // Some patches wrap the actual item in `message`.
            if (
              parsed.message &&
              typeof parsed.message === 'object'
            ) {
              pushEvent(
                {
                  ...parsed.message,
                  thread_id:
                    parsed.message.thread_id ||
                    threadID
                },
                {
                  ...metaThread,
                  thread_id: threadID
                },
                parsed.delta_type
              );
            }
          }
        } else {
          walk(
            patch,
            metaThread,
            inheritedDelta
          );
        }
      }

      return;
    }

    // Current realtime dispatcher-compatible wrapper.
    if (
      value.message &&
      typeof value.message === 'object'
    ) {
      pushEvent(
        value.message,
        {
          ...inheritedThread,
          thread_id:
            value.message.thread_id ||
            value.thread_id ||
            inheritedThread.thread_id
        },
        value.delta_type
      );
    }

    // Direct message item already normalized enough for FCA.
    if (
      value.thread_id &&
      (
        value.text != null ||
        value.item_type != null ||
        value.message_id != null ||
        value.item_id != null
      )
    ) {
      pushEvent(
        value,
        value,
        value.delta_type
      );
    }

    // Legacy direct packet where path + item fields coexist.
    if (
      value.path &&
      (
        value.item_id != null ||
        value.message_id != null ||
        value.text != null ||
        value.item_type != null
      )
    ) {
      pushEvent(
        value,
        {
          ...inheritedThread,
          thread_id:
            value.thread_id ||
            threadIdFromPath(value.path) ||
            inheritedThread.thread_id
        },
        value.delta_type
      );
    }
  };

  walk(packet);

  return events;
}

function normalizeCookieInput(
  input: any
): any[] {
  if (Array.isArray(input)) {
    return input;
  }

  if (
    input &&
    Array.isArray(
      input.cookies
    )
  ) {
    return input.cookies;
  }

  if (
    typeof input === 'string'
  ) {
    const text =
      input.trim();

    if (!text) {
      return [];
    }

    if (
      text.startsWith('[') ||
      text.startsWith('{')
    ) {
      try {
        return normalizeCookieInput(
          JSON.parse(text)
        );
      } catch (_) {
        // continue
      }
    }

    if (
      text.includes('\t')
    ) {
      return text
        .split(/\r?\n/)
        .filter(
          line =>
            line &&
            !line
              .trim()
              .startsWith('#')
        )
        .map(line => {
          const parts =
            line.split('\t');

          return {
            key:
              parts[5],

            value:
              parts[6],

            domain:
              parts[0] ||
              '.instagram.com',

            path:
              parts[2] ||
              '/'
          };
        })
        .filter(
          (c: any) =>
            c.key &&
            c.value
        );
    }

    return text
      .replace(
        /^cookie\s*:/i,
        ''
      )
      .split(';')
      .map(part => {
        const i =
          part.indexOf('=');

        if (i < 1) {
          return null;
        }

        return {
          key:
            part
              .slice(0, i)
              .trim(),

          value:
            part
              .slice(i + 1)
              .trim(),

          domain:
            '.instagram.com',

          path: '/'
        };
      })
      .filter(Boolean) as any[];
  }

  return [];
}

export async function loginCompat(
  a?: any,
  b?: any,
  c?: any
): Promise<any> {
  let options:
    LoginOptions = {};

  let callback:
    Function | undefined;

  if (
    typeof a === 'function'
  ) {
    callback = a;
  } else if (
    typeof b === 'function'
  ) {
    options =
      a || {};

    callback = b;
  } else if (
    typeof c === 'function'
  ) {
    options = {
      ...(b || {}),

      appState:
        a?.appState ?? a,

      cookies:
        a?.cookies ??
        b?.cookies
    };

    callback = c;
  } else {
    options = {
      ...(a || {})
    };
  }

  const ig =
    new IgApiClient();

  const loginUserAgent =
    options.userAgent ||
    DEFAULT_LOGIN_USER_AGENT;

  // `userAgent` is used only for web-session validation. The MQTT transport
  // must keep the native Instagram app User-Agent generated by State unless
  // the caller explicitly supplies an appUserAgent override.
  if (options.appUserAgent) {
    ig.state.appUserAgentOverride = String(options.appUserAgent);
  }

  const cookieInput =
    options.cookies ??
    options.appState;

  const cookies =
    normalizeCookieInput(
      cookieInput
    );

  const username =
    options.username ||
    cookies.find(
      (cookie: any) =>
        cookie.key ===
        'ds_user'
    )?.value ||
    `ica-${Date.now()}`;

  ig.state.generateDevice(
    username
  );

  if (options.proxy) {
    ig.state.proxyUrl =
      String(
        options.proxy
      );
  }

  try {
    if (cookies.length) {
      const cookieFile =
        path.join(
          process.cwd(),

          `.ica-tmp-cookies-${process.pid}-${Date.now()}.json`
        );

      fs.writeFileSync(
        cookieFile,
        JSON.stringify(
          cookies
        ),
        {
          mode: 0o600
        }
      );

      try {
        const loader =
          new CookieLoader(
            ig,
            cookieFile
          );

        const loaded =
          await loader.loadFromFile();

        if (!loaded) {
          throw new Error(
            'Failed to import Instagram cookies'
          );
        }
      } finally {
        try {
          fs.unlinkSync(
            cookieFile
          );
        } catch (_) {
          // ignore
        }
      }
    } else if (
      options.cookieFile
    ) {
      const loaded =
        await new CookieLoader(
          ig,
          options.cookieFile
        ).loadFromFile();

      if (!loaded) {
        throw new Error(
          `Failed to load cookies from ${options.cookieFile}`
        );
      }
    } else if (
      options.username &&
      options.password
    ) {
      await ig.account.login(
        options.username,
        options.password
      );
    } else {
      throw new Error(
        'Instagram authentication requires cookies/appState or username/password.'
      );
    }

    let user: any;

    try {
      // First use the private API's plain current-user endpoint. The legacy
      // `?edit=true` variant is intentionally avoided in AccountRepository.
      user = await ig.account.currentUser();
    } catch (error: any) {
      // Do not hide explicit authentication failures or checkpoints. For a
      // generic application-level response, fall back to the browser-style
      // web validation used by the supplied ig-chat-api login.
      if (
        error instanceof IgCheckpointError ||
        error instanceof IgLoginRequiredError ||
        error instanceof IgUserHasLoggedOutError
      ) {
        throw error;
      }

      const webUser = await validateWebSession(
        ig,
        loginUserAgent
      );

      user = {
        pk: webUser.userId,
        username: webUser.username,
      };
    }

    const api =
      new FcaInstagramApi(
        ig,
        options
      );

    api._userID =
      String(
        user?.pk ||
        user?.id ||
        ig.state.cookieUserId
      );

    (api as any)
      .appStateCache =
      cookies.slice();

    if (callback) {
      callback(
        null,
        api
      );
    }

    return api;
  } catch (
    error: any
  ) {
    if (callback) {
      callback(error);

      return undefined;
    }

    throw error;
  }
}

export default loginCompat;
