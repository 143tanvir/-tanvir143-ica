"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FcaInstagramApi = exports.METHODS = exports.DEFAULT_LOGIN_USER_AGENT = void 0;
exports.loginCompat = loginCompat;
const client_1 = require("./core/client");
const cookie_loader_1 = require("./core/cookie-loader");
const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const url_1 = require("url");
const request = require("request-promise");
const errors_1 = require("./errors");
exports.DEFAULT_LOGIN_USER_AGENT = 'Mozilla/5.0 (Linux; Android 12; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
async function validateWebSession(ig, userAgent) {
    var _a, _b, _c, _d, _e, _f;
    const response = await request({
        method: 'GET',
        uri: 'https://www.instagram.com/',
        jar: ig.state.cookieJar,
        resolveWithFullResponse: true,
        simple: false,
        gzip: true,
        timeout: 30000,
        headers: {
            'User-Agent': userAgent || exports.DEFAULT_LOGIN_USER_AGENT,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            Referer: 'https://www.instagram.com/',
        },
    });
    const html = String((response === null || response === void 0 ? void 0 : response.body) || '');
    const finalUrl = String(((_b = (_a = response === null || response === void 0 ? void 0 : response.request) === null || _a === void 0 ? void 0 : _a.uri) === null || _b === void 0 ? void 0 : _b.href) ||
        ((_c = response === null || response === void 0 ? void 0 : response.request) === null || _c === void 0 ? void 0 : _c.href) ||
        '');
    if ((response === null || response === void 0 ? void 0 : response.statusCode) < 200 || (response === null || response === void 0 ? void 0 : response.statusCode) >= 400) {
        throw new Error(`Instagram web session check returned HTTP ${response === null || response === void 0 ? void 0 : response.statusCode}`);
    }
    if (/\/(?:accounts\/)?login(?:\/|$)/i.test(finalUrl) ||
        /<title[^>]*>\s*Instagram\s*\/\s*Login\s*<\/title>/i.test(html)) {
        throw new Error('Instagram session is not authenticated');
    }
    const username = ((_d = html.match(/\"username\":\"([^\"]+)\"/)) === null || _d === void 0 ? void 0 : _d[1]) ||
        ((_e = html.match(/\"alternateName\":\"@?([^\"]+)\"/)) === null || _e === void 0 ? void 0 : _e[1]);
    let userId = ((_f = html.match(/\"(?:user_id|profilePage_\w*id)\":\"?(\d+)\"?/)) === null || _f === void 0 ? void 0 : _f[1]) ||
        '';
    if (!userId) {
        try {
            userId = String(ig.state.cookieUserId || '');
        }
        catch (_) {
            userId = '';
        }
    }
    if (!userId) {
        throw new Error('Instagram web session did not expose an authenticated user id');
    }
    return { userId, username };
}
exports.METHODS = [
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
    'getCurrentUserID',
    'listenMqtt',
    'listen',
    'setBiography',
    'removeMessageReaction',
    'createGroupThread',
    'getPresence',
    'hideThread',
    'leaveThread'
];
function nodeify(promise, cb) {
    if (typeof cb === 'function') {
        promise.then(value => cb(null, value), error => cb(error));
        return;
    }
    return promise;
}
function sourceToBuffer(source) {
    if (Buffer.isBuffer(source)) {
        return Promise.resolve(source);
    }
    if (source == null) {
        return Promise.reject(new Error('Media source is required'));
    }
    if (source &&
        Buffer.isBuffer(source.buffer)) {
        return Promise.resolve(source.buffer);
    }
    if (source &&
        typeof source.path === 'string') {
        return fs.promises.readFile(source.path);
    }
    if (typeof source === 'string') {
        if (/^https?:\/\//i.test(source)) {
            return downloadBuffer(source);
        }
        return fs.promises.readFile(source);
    }
    if (source &&
        typeof source.pipe === 'function') {
        return new Promise((resolve, reject) => {
            const chunks = [];
            source.on('data', (chunk) => {
                chunks.push(Buffer.isBuffer(chunk)
                    ? chunk
                    : Buffer.from(chunk));
            });
            source.on('end', () => {
                resolve(Buffer.concat(chunks));
            });
            source.on('error', reject);
        });
    }
    return Promise.reject(new Error('Unsupported media source. Use a Buffer, path, URL or readable stream.'));
}
function normalizeBroadcastResult(result, fallbackThreadID) {
    var _a, _b, _c, _d, _e, _f, _g;
    const payload = (_a = result === null || result === void 0 ? void 0 : result.payload) !== null && _a !== void 0 ? _a : result;
    const metadata = Array.isArray(result === null || result === void 0 ? void 0 : result.message_metadata)
        ? result.message_metadata[0]
        : undefined;
    return {
        messageID: String((_e = (_d = (_c = (_b = payload === null || payload === void 0 ? void 0 : payload.item_id) !== null && _b !== void 0 ? _b : payload === null || payload === void 0 ? void 0 : payload.message_id) !== null && _c !== void 0 ? _c : metadata === null || metadata === void 0 ? void 0 : metadata.item_id) !== null && _d !== void 0 ? _d : metadata === null || metadata === void 0 ? void 0 : metadata.message_id) !== null && _e !== void 0 ? _e : ''),
        threadID: String((_g = (_f = payload === null || payload === void 0 ? void 0 : payload.thread_id) !== null && _f !== void 0 ? _f : metadata === null || metadata === void 0 ? void 0 : metadata.thread_id) !== null && _g !== void 0 ? _g : fallbackThreadID),
        _raw: result
    };
}
function downloadBuffer(address) {
    return new Promise((resolve, reject) => {
        const url = new url_1.URL(address);
        const transport = url.protocol === 'https:'
            ? https
            : http;
        const req = transport.get(url, response => {
            if (response.statusCode &&
                response.statusCode >= 300 &&
                response.statusCode < 400 &&
                response.headers.location) {
                response.resume();
                return downloadBuffer(new url_1.URL(response.headers.location, url).toString()).then(resolve, reject);
            }
            if (!response.statusCode ||
                response.statusCode < 200 ||
                response.statusCode >= 300) {
                response.resume();
                return reject(new Error(`Media download failed with HTTP ${response.statusCode || 0}`));
            }
            const chunks = [];
            response.on('data', (chunk) => {
                chunks.push(chunk);
            });
            response.on('end', () => {
                resolve(Buffer.concat(chunks));
            });
            response.on('error', reject);
        });
        req.on('error', reject);
    });
}
function normalizeUser(user) {
    var _a, _b, _c, _d, _e;
    if (!user) {
        return null;
    }
    return {
        userID: String(user.pk ||
            user.user_id ||
            user.id ||
            ''),
        name: user.full_name ||
            user.name ||
            user.first_name ||
            user.username ||
            '',
        firstName: user.first_name ||
            (user.full_name
                ? String(user.full_name).split(/\s+/)[0]
                : user.username || ''),
        vanity: user.username ||
            user.vanity ||
            '',
        username: user.username ||
            user.vanity ||
            '',
        profileUrl: user.username
            ? `https://www.instagram.com/${user.username}/`
            : null,
        thumbSrc: user.profile_pic_url ||
            user.profilePicture ||
            ((_a = user.hd_profile_pic_url_info) === null || _a === void 0 ? void 0 : _a.url) ||
            null,
        profilePicture: user.profile_pic_url ||
            user.profilePicture ||
            null,
        biography: user.biography ||
            '',
        followerCount: (_b = user.follower_count) !== null && _b !== void 0 ? _b : user.followerCount,
        followingCount: (_c = user.following_count) !== null && _c !== void 0 ? _c : user.followingCount,
        isPrivate: (_d = user.is_private) !== null && _d !== void 0 ? _d : user.isPrivate,
        isVerified: (_e = user.is_verified) !== null && _e !== void 0 ? _e : user.isVerified,
        _raw: user
    };
}
function normalizeItem(item, thread, botId) {
    var _a, _b, _c, _d, _e, _f, _g;
    const itemId = String((item === null || item === void 0 ? void 0 : item.item_id) ||
        (item === null || item === void 0 ? void 0 : item.message_id) ||
        (item === null || item === void 0 ? void 0 : item.id) ||
        '');
    const senderID = (item === null || item === void 0 ? void 0 : item.user_id) != null
        ? String(item.user_id)
        : null;
    const type = (item === null || item === void 0 ? void 0 : item.item_type) ||
        (item === null || item === void 0 ? void 0 : item.type) ||
        'text';
    const body = (item === null || item === void 0 ? void 0 : item.text) != null
        ? String(item.text)
        : '';
    const attachments = [];
    const media = ((_a = item === null || item === void 0 ? void 0 : item.visual_media) === null || _a === void 0 ? void 0 : _a.media) ||
        (item === null || item === void 0 ? void 0 : item.media) ||
        (item === null || item === void 0 ? void 0 : item.clip) ||
        ((_b = item === null || item === void 0 ? void 0 : item.reel_share) === null || _b === void 0 ? void 0 : _b.media);
    if (media) {
        const mediaUrl = ((_e = (_d = (_c = media === null || media === void 0 ? void 0 : media.image_versions2) === null || _c === void 0 ? void 0 : _c.candidates) === null || _d === void 0 ? void 0 : _d[0]) === null || _e === void 0 ? void 0 : _e.url) ||
            ((_g = (_f = media === null || media === void 0 ? void 0 : media.video_versions) === null || _f === void 0 ? void 0 : _f[0]) === null || _g === void 0 ? void 0 : _g.url) ||
            (media === null || media === void 0 ? void 0 : media.thumbnail_url);
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
        threadID: String((thread === null || thread === void 0 ? void 0 : thread.thread_id) ||
            (thread === null || thread === void 0 ? void 0 : thread.thread_v2_id) ||
            ''),
        body,
        attachments,
        timestamp: Number((item === null || item === void 0 ? void 0 : item.timestamp) ||
            (item === null || item === void 0 ? void 0 : item.timestamp_ms) ||
            Date.now()),
        type: senderID &&
            botId &&
            senderID === botId
            ? 'message'
            : 'message',
        isGroup: !!((thread === null || thread === void 0 ? void 0 : thread.is_group) ||
            (thread === null || thread === void 0 ? void 0 : thread.isGroup) ||
            (thread === null || thread === void 0 ? void 0 : thread.thread_type) === 'group'),
        participantIDs: Array.isArray(thread === null || thread === void 0 ? void 0 : thread.users)
            ? thread.users.map((u) => String(u.pk))
            : [],
        _raw: item
    };
}
function normalizeThread(thread) {
    var _a;
    const users = Array.isArray(thread === null || thread === void 0 ? void 0 : thread.users)
        ? thread.users
        : [];
    const participantIDs = users
        .map((u) => String(u.pk))
        .filter(Boolean);
    const lastItem = (thread === null || thread === void 0 ? void 0 : thread.last_permanent_item) ||
        ((_a = thread === null || thread === void 0 ? void 0 : thread.items) === null || _a === void 0 ? void 0 : _a[0]) ||
        null;
    return {
        threadID: String((thread === null || thread === void 0 ? void 0 : thread.thread_id) ||
            (thread === null || thread === void 0 ? void 0 : thread.thread_v2_id) ||
            ''),
        threadName: (thread === null || thread === void 0 ? void 0 : thread.thread_title) ||
            (thread === null || thread === void 0 ? void 0 : thread.name) ||
            (thread === null || thread === void 0 ? void 0 : thread.title) ||
            users
                .map((u) => u.username)
                .filter(Boolean)
                .join(', '),
        name: (thread === null || thread === void 0 ? void 0 : thread.thread_title) ||
            (thread === null || thread === void 0 ? void 0 : thread.name) ||
            (thread === null || thread === void 0 ? void 0 : thread.title) ||
            users
                .map((u) => u.username)
                .filter(Boolean)
                .join(', '),
        participantIDs,
        participants: users
            .map(normalizeUser)
            .filter(Boolean),
        isGroup: !!((thread === null || thread === void 0 ? void 0 : thread.is_group) ||
            (thread === null || thread === void 0 ? void 0 : thread.isGroup) ||
            participantIDs.length > 2 ||
            (thread === null || thread === void 0 ? void 0 : thread.thread_type) === 'group'),
        threadType: thread === null || thread === void 0 ? void 0 : thread.thread_type,
        muted: !!(thread === null || thread === void 0 ? void 0 : thread.muted),
        messageCount: Array.isArray(thread === null || thread === void 0 ? void 0 : thread.items)
            ? thread.items.length
            : undefined,
        lastMessage: lastItem
            ? normalizeItem(lastItem, thread)
            : null,
        _raw: thread
    };
}
function effectStyle(name) {
    const key = String(name || '')
        .toLowerCase();
    const map = {
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
class FcaInstagramApi {
    constructor(client, options = {}) {
        this._userID = null;
        this.mqttStarted = false;
        this.mqttHandlers = [];
        this.appStateCache = [];
        this.client = client;
        this.options = options;
    }
    getCurrentUserID() {
        try {
            return (this._userID ||
                this.client.state.cookieUserId ||
                null);
        }
        catch (_) {
            return this._userID;
        }
    }
    async getUserInfo(userIDs, cb) {
        const ids = Array.isArray(userIDs)
            ? userIDs
            : [userIDs];
        const entries = {};
        for (const id of ids) {
            const key = String(id);
            let user;
            if (/^\d+$/.test(key)) {
                user =
                    await this.client.user.info(key);
            }
            else {
                user =
                    await this.client.user.usernameinfo(key);
            }
            const normalized = normalizeUser(user);
            if (normalized) {
                entries[key] =
                    normalized;
            }
        }
        return nodeify(Promise.resolve(entries), cb);
    }
    async getThreadList(limit = 20, _timestamp, _tags = [], cb) {
        var _a;
        const feed = this.client.feed.directInbox();
        const response = await feed.request();
        const threads = Array.isArray((_a = response === null || response === void 0 ? void 0 : response.inbox) === null || _a === void 0 ? void 0 : _a.threads)
            ? response.inbox.threads
            : [];
        return nodeify(Promise.resolve(threads
            .slice(0, Number(limit) || 20)
            .map(normalizeThread)), cb);
    }
    async getThreadInfo(threadID, cb) {
        var _a, _b;
        const feed = this.client.feed.directThread({
            thread_id: String(threadID),
            oldest_cursor: ''
        });
        const response = await feed.request();
        const thread = (response === null || response === void 0 ? void 0 : response.thread) ||
            ((_b = (_a = response === null || response === void 0 ? void 0 : response.inbox) === null || _a === void 0 ? void 0 : _a.threads) === null || _b === void 0 ? void 0 : _b[0]);
        const value = normalizeThread(thread || {
            thread_id: String(threadID)
        });
        return nodeify(Promise.resolve(value), cb);
    }
    async getThreadHistory(threadID, amount = 50, _timestamp, cb) {
        const feed = this.client.feed.directThread({
            thread_id: String(threadID),
            oldest_cursor: ''
        });
        const response = await feed.request();
        const thread = (response === null || response === void 0 ? void 0 : response.thread) || {};
        const items = Array.isArray(thread.items)
            ? thread.items
            : [];
        const normalized = items
            .slice(0, Number(amount) || 50)
            .map((item) => normalizeItem(item, thread, this.getCurrentUserID() ||
            undefined));
        return nodeify(Promise.resolve(normalized), cb);
    }
    async sendMessage(message, threadID, cb, replyToMessage) {
        var _a;
        const payload = typeof message === 'string'
            ? message
            : String((_a = message === null || message === void 0 ? void 0 : message.body) !== null && _a !== void 0 ? _a : '');
        const thread = this.client.entity.directThread(String(threadID));
        const result = await thread.broadcastText(payload);
        const value = {
            messageID: String((result === null || result === void 0 ? void 0 : result.item_id) ||
                (result === null || result === void 0 ? void 0 : result.message_id) ||
                (result === null || result === void 0 ? void 0 : result.id) ||
                (result === null || result === void 0 ? void 0 : result.thread_id) ||
                ''),
            threadID: String((result === null || result === void 0 ? void 0 : result.thread_id) ||
                threadID),
            _raw: result,
            replyToMessageID: replyToMessage || null
        };
        return nodeify(Promise.resolve(value), cb);
    }
    async sendImage(source, threadID, _caption = '', cb, _replyToMessage) {
        const buffer = await sourceToBuffer(source);
        const result = await this.client.entity.directThread(String(threadID)).broadcastPhoto({
            file: buffer
        });
        return nodeify(Promise.resolve(normalizeBroadcastResult(result, String(threadID))), cb);
    }
    async sendAudio(source, threadID, cb, _replyToMessage) {
        const buffer = await sourceToBuffer(source);
        const result = await this.client.entity.directThread(String(threadID)).broadcastVoice({
            file: buffer
        });
        return nodeify(Promise.resolve(normalizeBroadcastResult(result, String(threadID))), cb);
    }
    async sendVideo(source, threadID, cb, _replyToMessage) {
        const buffer = await sourceToBuffer(source);
        const result = await this.client.entity.directThread(String(threadID)).broadcastVideo({
            video: buffer
        });
        return nodeify(Promise.resolve(normalizeBroadcastResult(result, String(threadID))), cb);
    }
    async sendTextEffect(text, threadID, effect, cb) {
        const response = await this.client.directThread.broadcast({
            item: 'text',
            threadIds: String(threadID),
            form: {
                text: String(text),
                power_up_data: JSON.stringify({
                    style: effectStyle(effect)
                })
            }
        });
        return nodeify(Promise.resolve((response === null || response === void 0 ? void 0 : response.payload) ||
            response), cb);
    }
    async sendAvatarTextEffect(text, threadID, effect, cb) {
        const response = await this.client.directThread.broadcast({
            item: 'text',
            threadIds: String(threadID),
            form: {
                text: String(text),
                power_up_data: JSON.stringify({
                    style: effectStyle(effect)
                })
            }
        });
        return nodeify(Promise.resolve((response === null || response === void 0 ? void 0 : response.payload) ||
            response), cb);
    }
    async sendMusic(threadID, track, cb) {
        const value = track &&
            typeof track === 'object'
            ? track
            : {
                id: String(track)
            };
        const form = {
            music_id: value.id ||
                value.pk ||
                value.music_id,
            track_id: value.track_id ||
                value.id ||
                value.pk,
            title: value.title ||
                value.name,
            artist: value.artist ||
                value.artist_name,
            cover_artwork_uri: value.cover_artwork_uri ||
                value.cover_artwork_url
        };
        const response = await this.client.directThread.broadcast({
            item: 'music',
            threadIds: String(threadID),
            form
        });
        return nodeify(Promise.resolve((response === null || response === void 0 ? void 0 : response.payload) ||
            response), cb);
    }
    async musicSearch(query, cb) {
        const feed = this.client.feed.musicSearch(String(query));
        const items = await feed.items();
        return nodeify(Promise.resolve(items), cb);
    }
    sendTypingIndicator(threadID, cb) {
        const start = async () => {
            if (!this.mqttStarted) {
                await this.client.mqtt.connect();
                this.mqttStarted =
                    true;
            }
            this.client.mqtt.sendTypingIndicator(String(threadID), true);
            return {
                threadID: String(threadID),
                typing: true
            };
        };
        const result = start();
        if (typeof cb === 'function') {
            result.then(v => cb(null, v), e => cb(e));
        }
        return () => this.stopTypingIndicator(threadID);
    }
    async stopTypingIndicator(threadID, cb) {
        if (!this.mqttStarted) {
            return nodeify(Promise.resolve({
                threadID: String(threadID),
                typing: false
            }), cb);
        }
        this.client.mqtt.sendTypingIndicator(String(threadID), false);
        return nodeify(Promise.resolve({
            threadID: String(threadID),
            typing: false
        }), cb);
    }
    async setMessageReaction(reaction, messageID, threadID, cb) {
        const emoji = reaction || '❤';
        const response = await this.client.directThread.broadcast({
            item: 'reaction',
            threadIds: String(threadID),
            form: {
                item_type: 'reaction',
                reaction_type: 'like',
                reaction_status: 'created',
                node_type: 'item',
                item_id: String(messageID),
                emoji,
                reaction_action_source: 'double_tap',
                send_attribution: 'message_reaction'
            }
        });
        return nodeify(Promise.resolve((response === null || response === void 0 ? void 0 : response.payload) ||
            response), cb);
    }
    async removeMessageReaction(reaction, messageID, threadID, cb) {
        const emoji = reaction || '❤';
        const response = await this.client.directThread.broadcast({
            item: 'reaction',
            threadIds: String(threadID),
            form: {
                item_type: 'reaction',
                reaction_type: 'like',
                reaction_status: 'deleted',
                node_type: 'item',
                item_id: String(messageID),
                emoji,
                reaction_action_source: 'double_tap',
                send_attribution: 'message_reaction'
            }
        });
        return nodeify(Promise.resolve((response === null || response === void 0 ? void 0 : response.payload) ||
            response), cb);
    }
    async unsendMessage(messageID, threadID, cb) {
        const result = await this.client.directThread.deleteItem(String(threadID), String(messageID));
        return nodeify(Promise.resolve(result), cb);
    }
    async deleteMessage(messageID, threadID, cb) {
        return this.unsendMessage(messageID, threadID, cb);
    }
    async markAsRead(threadID, cb) {
        var _a;
        const info = await this.getThreadInfo(String(threadID));
        const itemID = (_a = info === null || info === void 0 ? void 0 : info.lastMessage) === null || _a === void 0 ? void 0 : _a.messageID;
        if (!itemID) {
            return nodeify(Promise.resolve({
                status: 'ok',
                threadID: String(threadID),
                marked: false
            }), cb);
        }
        const result = await this.client.directThread.markItemSeen(String(threadID), String(itemID));
        return nodeify(Promise.resolve(result), cb);
    }
    async markAsDelivered(threadID, cb) {
        const result = {
            status: 'unsupported',
            threadID: String(threadID),
            message: 'Instagram private API client does not expose a separate delivered receipt endpoint.'
        };
        if (typeof cb === 'function') {
            cb(null, result);
        }
        return result;
    }
    async setTitle(title, threadID, cb) {
        const result = await this.client.directThread.updateTitle(String(threadID), String(title));
        return nodeify(Promise.resolve(result), cb);
    }
    async addUserToThread(userID, threadID, cb) {
        const result = await this.client.directThread.addUser(String(threadID), [String(userID)]);
        return nodeify(Promise.resolve(result), cb);
    }
    async removeUserFromThread(userID, threadID, cb) {
        const result = await this.client.directThread.removeUser(String(threadID), [String(userID)]);
        return nodeify(Promise.resolve(result), cb);
    }
    async changeThreadMute(mute, threadID, cb) {
        const result = mute
            ? await this.client.directThread.mute(String(threadID))
            : await this.client.directThread.unmute(String(threadID));
        return nodeify(Promise.resolve(result), cb);
    }
    async changeBio(text, cb) {
        const result = await this.client.account.setBiography(String(text));
        return nodeify(Promise.resolve(result), cb);
    }
    async changeProfilePicture(source, cb) {
        const buffer = await sourceToBuffer(source);
        const result = await this.client.account.changeProfilePicture(buffer);
        return nodeify(Promise.resolve(result), cb);
    }
    async changeAvatar(source, cb) {
        return this.changeProfilePicture(source, cb);
    }
    getAppState() {
        return this.appStateCache.slice();
    }
    setOptions(options = {}, cb) {
        this.options = Object.assign(Object.assign({}, this.options), options);
        if ((options === null || options === void 0 ? void 0 : options.proxy) !== undefined) {
            this.client.state.proxyUrl =
                options.proxy || '';
        }
        if (options === null || options === void 0 ? void 0 : options.userAgent) {
            this.client.state.appUserAgentOverride = String(options.userAgent);
        }
        const result = this.options;
        if (typeof cb === 'function') {
            cb(null, result);
        }
        return result;
    }
    async logout(cb) {
        const result = await this.client.account.logout();
        return nodeify(Promise.resolve(result), cb);
    }
    async createGroupThread(recipientUsers, threadTitle, cb) {
        const result = await this.client.direct.createGroupThread(recipientUsers.map(String), String(threadTitle));
        return nodeify(Promise.resolve(result), cb);
    }
    async getPresence(cb) {
        const result = await this.client.direct.getPresence();
        return nodeify(Promise.resolve(result), cb);
    }
    async hideThread(threadID, cb) {
        const result = await this.client.directThread.hide(String(threadID));
        return nodeify(Promise.resolve(result), cb);
    }
    async leaveThread(threadID, cb) {
        const result = await this.client.directThread.leave(String(threadID));
        return nodeify(Promise.resolve(result), cb);
    }
    async setBiography(text, cb) {
        return this.changeBio(text, cb);
    }
    listenMqtt(cb) {
        let stopped = false;
        const handlers = this.mqttHandlers;
        const onMessage = (data) => {
            if (stopped) {
                return;
            }
            const packets = Array.isArray(data)
                ? data
                : [data];
            for (const packet of packets) {
                for (const message of extractEvents(packet, this.getCurrentUserID())) {
                    cb(null, message);
                }
            }
        };
        this.client.mqtt.on('/ig_message_sync', onMessage);
        this.client.mqtt.on('/ig_send_message_response', onMessage);
        this.client.mqtt.on('/ig_typing_indicator', onMessage);
        this.client.mqtt.on('/pubsub', onMessage);
        handlers.push(onMessage);
        const connect = async () => {
            await this.client.mqtt.connect();
            this.mqttStarted =
                true;
        };
        connect().catch(error => cb(error));
        return () => {
            if (stopped) {
                return;
            }
            stopped = true;
            this.client.mqtt.off('/ig_message_sync', onMessage);
            this.client.mqtt.off('/ig_send_message_response', onMessage);
            this.client.mqtt.off('/ig_typing_indicator', onMessage);
            this.client.mqtt.off('/pubsub', onMessage);
            const index = handlers.indexOf(onMessage);
            if (index >= 0) {
                handlers.splice(index, 1);
            }
        };
    }
    listen(cb) {
        return this.listenMqtt(cb);
    }
}
exports.FcaInstagramApi = FcaInstagramApi;
function extractEvents(packet, botID) {
    const events = [];
    const candidate = (packet === null || packet === void 0 ? void 0 : packet.data) ||
        (packet === null || packet === void 0 ? void 0 : packet.message) ||
        packet;
    const arr = Array.isArray(candidate)
        ? candidate
        : [candidate];
    for (const item of arr) {
        if (!item ||
            typeof item !== 'object') {
            continue;
        }
        if (item.delta_type &&
            item.message) {
            const raw = item.message;
            const thread = {
                thread_id: raw.thread_id,
                users: raw.users,
                is_group: raw.is_group
            };
            const event = normalizeItem(raw, thread, botID || undefined);
            const itemType = String(raw.item_type || '').toLowerCase();
            if (/reaction/.test(itemType) ||
                item.delta_type ===
                    'deltaReaction') {
                event.type =
                    'message_reaction';
            }
            else if (/unsend|delete/.test(itemType) ||
                /Unsend|Delete/i.test(String(item.delta_type))) {
                event.type =
                    'message_unsend';
            }
            else {
                event.type =
                    'message';
            }
            events.push(event);
            continue;
        }
        if (item.path &&
            item.item_id) {
            events.push(normalizeItem(item, item, botID || undefined));
            continue;
        }
        if (item.thread_id &&
            (item.text != null ||
                item.item_type)) {
            events.push(normalizeItem(item, item, botID || undefined));
        }
    }
    return events;
}
function normalizeCookieInput(input) {
    if (Array.isArray(input)) {
        return input;
    }
    if (input &&
        Array.isArray(input.cookies)) {
        return input.cookies;
    }
    if (typeof input === 'string') {
        const text = input.trim();
        if (!text) {
            return [];
        }
        if (text.startsWith('[') ||
            text.startsWith('{')) {
            try {
                return normalizeCookieInput(JSON.parse(text));
            }
            catch (_) {
            }
        }
        if (text.includes('\t')) {
            return text
                .split(/\r?\n/)
                .filter(line => line &&
                !line
                    .trim()
                    .startsWith('#'))
                .map(line => {
                const parts = line.split('\t');
                return {
                    key: parts[5],
                    value: parts[6],
                    domain: parts[0] ||
                        '.instagram.com',
                    path: parts[2] ||
                        '/'
                };
            })
                .filter((c) => c.key &&
                c.value);
        }
        return text
            .replace(/^cookie\s*:/i, '')
            .split(';')
            .map(part => {
            const i = part.indexOf('=');
            if (i < 1) {
                return null;
            }
            return {
                key: part
                    .slice(0, i)
                    .trim(),
                value: part
                    .slice(i + 1)
                    .trim(),
                domain: '.instagram.com',
                path: '/'
            };
        })
            .filter(Boolean);
    }
    return [];
}
async function loginCompat(a, b, c) {
    var _a, _b, _c, _d;
    let options = {};
    let callback;
    if (typeof a === 'function') {
        callback = a;
    }
    else if (typeof b === 'function') {
        options =
            a || {};
        callback = b;
    }
    else if (typeof c === 'function') {
        options = Object.assign(Object.assign({}, (b || {})), { appState: (_a = a === null || a === void 0 ? void 0 : a.appState) !== null && _a !== void 0 ? _a : a, cookies: (_b = a === null || a === void 0 ? void 0 : a.cookies) !== null && _b !== void 0 ? _b : b === null || b === void 0 ? void 0 : b.cookies });
        callback = c;
    }
    else {
        options = Object.assign({}, (a || {}));
    }
    const ig = new client_1.IgApiClient();
    const loginUserAgent = options.userAgent ||
        exports.DEFAULT_LOGIN_USER_AGENT;
    ig.state.appUserAgentOverride = String(loginUserAgent);
    const cookieInput = (_c = options.cookies) !== null && _c !== void 0 ? _c : options.appState;
    const cookies = normalizeCookieInput(cookieInput);
    const username = options.username ||
        ((_d = cookies.find((cookie) => cookie.key ===
            'ds_user')) === null || _d === void 0 ? void 0 : _d.value) ||
        `ica-${Date.now()}`;
    ig.state.generateDevice(username);
    if (options.proxy) {
        ig.state.proxyUrl =
            String(options.proxy);
    }
    try {
        if (cookies.length) {
            const cookieFile = path.join(process.cwd(), `.ica-tmp-cookies-${process.pid}-${Date.now()}.json`);
            fs.writeFileSync(cookieFile, JSON.stringify(cookies), {
                mode: 0o600
            });
            try {
                const loader = new cookie_loader_1.CookieLoader(ig, cookieFile);
                const loaded = await loader.loadFromFile();
                if (!loaded) {
                    throw new Error('Failed to import Instagram cookies');
                }
            }
            finally {
                try {
                    fs.unlinkSync(cookieFile);
                }
                catch (_) {
                }
            }
        }
        else if (options.cookieFile) {
            const loaded = await new cookie_loader_1.CookieLoader(ig, options.cookieFile).loadFromFile();
            if (!loaded) {
                throw new Error(`Failed to load cookies from ${options.cookieFile}`);
            }
        }
        else if (options.username &&
            options.password) {
            await ig.account.login(options.username, options.password);
        }
        else {
            throw new Error('Instagram authentication requires cookies/appState or username/password.');
        }
        let user;
        try {
            user = await ig.account.currentUser();
        }
        catch (error) {
            if (error instanceof errors_1.IgCheckpointError ||
                error instanceof errors_1.IgLoginRequiredError ||
                error instanceof errors_1.IgUserHasLoggedOutError) {
                throw error;
            }
            const webUser = await validateWebSession(ig, loginUserAgent);
            user = {
                pk: webUser.userId,
                username: webUser.username,
            };
        }
        const api = new FcaInstagramApi(ig, options);
        api._userID =
            String((user === null || user === void 0 ? void 0 : user.pk) ||
                (user === null || user === void 0 ? void 0 : user.id) ||
                ig.state.cookieUserId);
        api
            .appStateCache =
            cookies.slice();
        if (callback) {
            callback(null, api);
        }
        return api;
    }
    catch (error) {
        if (callback) {
            callback(error);
            return undefined;
        }
        throw error;
    }
}
exports.default = loginCompat;
//# sourceMappingURL=fca-compat.js.map