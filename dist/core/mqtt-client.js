"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InstagramMqttClient = void 0;
const WebSocket = require("ws");
const debug_1 = require("debug");
const logger = (0, debug_1.default)('ig:mqtt');
class InstagramMqttClient {
    constructor(ig) {
        this.ig = ig;
        this.ws = null;
        this.subscriptions = new Map();
        this.reconnectInterval = null;
        this.isConnecting = false;
        this.heartbeatInterval = null;
        this.sessionId = null;
    }
    async connect(config) {
        var _a;
        if (this.isConnecting || ((_a = this.ws) === null || _a === void 0 ? void 0 : _a.readyState) === 1) {
            logger('Already connected or connecting');
            return;
        }
        this.isConnecting = true;
        try {
            const cookies = await this.ig.state.cookieJar.getCookies('https://www.instagram.com');
            const cookieHeader = cookies.map(c => `${c.key}=${c.value}`).join('; ');
            const sessionCookie = cookies.find(c => c.key === 'sessionid');
            const deviceIdCookie = cookies.find(c => c.key === 'ig_did');
            if (!sessionCookie) {
                throw new Error('Missing sessionid cookie for MQTT');
            }
            const deviceId = (deviceIdCookie === null || deviceIdCookie === void 0 ? void 0 : deviceIdCookie.value) || this.generateClientId();
            this.sessionId = sessionCookie.value.split('%')[0];
            const wsUrl = `wss://edge-chat.instagram.com/chat?sid=${this.sessionId}&cid=${deviceId}`;
            logger('Connecting to:', wsUrl);
            this.ws = new WebSocket(wsUrl, {
                headers: {
                    Host: 'edge-chat.instagram.com',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
                    Connection: 'Upgrade',
                    'Accept-Encoding': 'gzip, deflate, br, zstd',
                    Pragma: 'no-cache',
                    'Cache-Control': 'no-cache',
                    Upgrade: 'websocket',
                    Origin: 'https://www.instagram.com',
                    'Sec-WebSocket-Version': '13',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Sec-WebSocket-Extensions': 'permessage-deflate; client_max_window_bits',
                    Cookie: cookieHeader,
                },
            });
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    this.isConnecting = false;
                    reject(new Error('Connection timeout'));
                }, 15000);
                this.ws.on('open', () => {
                    clearTimeout(timeout);
                    this.isConnecting = false;
                    logger('✅ MQTT WebSocket connected');
                    this.sendConnectPacket();
                    this.setupHeartbeat();
                    this.setupReconnect();
                    resolve();
                });
                this.ws.on('message', (data) => {
                    this.handleMessage(data);
                });
                this.ws.on('error', err => {
                    clearTimeout(timeout);
                    this.isConnecting = false;
                    logger('❌ MQTT error:', err.message);
                    reject(err);
                });
                this.ws.on('close', () => {
                    this.isConnecting = false;
                    logger('🔌 MQTT disconnected');
                    this.cleanup();
                    this.setupReconnect();
                });
            });
        }
        catch (error) {
            this.isConnecting = false;
            throw error;
        }
    }
    generateClientId() {
        return `${Date.now()}-${Math.random()
            .toString(36)
            .substr(2, 9)}`;
    }
    sendConnectPacket() {
        if (!this.isConnected())
            return;
        setTimeout(() => {
            this.subscribeToMessages();
        }, 100);
        logger('📡 MQTT CONNECT sent');
    }
    subscribeToMessages() {
        if (!this.isConnected())
            return;
        const subscribeTopics = [
            '/ig_message_sync',
            '/ig_send_message_response',
            '/ig_typing_indicator',
            '/ig_sub_iris_response',
            '/pubsub',
        ];
        subscribeTopics.forEach(topic => {
            const subscribePacket = this.buildSubscribePacket(topic);
            this.ws.send(subscribePacket);
            logger(`📡 Subscribed to ${topic}`);
        });
    }
    buildSubscribePacket(topic) {
        const topicBytes = Buffer.from(topic, 'utf8');
        const packetId = Math.floor(Math.random() * 65535);
        const fixedHeader = Buffer.from([0x82, topicBytes.length + 5]);
        const variableHeader = Buffer.from([(packetId >> 8) & 0xff, packetId & 0xff]);
        const topicLength = Buffer.from([(topicBytes.length >> 8) & 0xff, topicBytes.length & 0xff]);
        const qos = Buffer.from([0x01]);
        return Buffer.concat([fixedHeader, variableHeader, topicLength, topicBytes, qos]);
    }
    setupHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }
        this.heartbeatInterval = setInterval(() => {
            if (this.isConnected()) {
                const pingPacket = Buffer.from([0xc0, 0x00]);
                this.ws.send(pingPacket);
                logger('💓 PINGREQ sent');
            }
        }, 30000);
    }
    cleanup() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }
    setupReconnect() {
        if (this.reconnectInterval)
            return;
        this.reconnectInterval = setInterval(() => {
            if (!this.isConnected() && !this.isConnecting) {
                logger('🔄 Reconnecting...');
                this.connect().catch(err => {
                    logger('Reconnect failed:', err.message);
                });
            }
        }, 5000);
    }
    handleMessage(data) {
        try {
            const messageType = (data[0] >> 4) & 0x0f;
            logger('📩 MQTT packet type:', messageType.toString(16));
            if (messageType === 3) {
                const qos = (data[0] >> 1) & 0x03;
                let pos = 1;
                let byte;
                do {
                    byte = data[pos++];
                } while ((byte & 128) !== 0);
                const topicLength = (data[pos] << 8) | data[pos + 1];
                pos += 2;
                const topic = data.slice(pos, pos + topicLength).toString('utf8');
                pos += topicLength;
                if (qos > 0) {
                    pos += 2;
                }
                const payload = data.slice(pos);
                logger(`📬 Topic: ${topic}`);
                logger(`📦 Payload:`, payload.toString('utf8').substring(0, 200));
                try {
                    const jsonPayload = JSON.parse(payload.toString('utf8'));
                    this.triggerHandlers(topic, jsonPayload);
                    this.triggerHandlers('*', { topic, data: jsonPayload });
                }
                catch (_a) {
                    logger('Binary payload received');
                }
            }
            if (messageType === 13) {
                logger('💓 PINGRESP received');
            }
        }
        catch (error) {
            logger('Error parsing MQTT packet:', error);
        }
    }
    triggerHandlers(topic, data) {
        const handlers = this.subscriptions.get(topic);
        if (handlers) {
            handlers.forEach(handler => {
                try {
                    handler(data);
                }
                catch (err) {
                    logger('Handler error:', err);
                }
            });
        }
    }
    sendTypingIndicator(threadId, isTyping = true) {
        if (!this.isConnected()) {
            logger('❌ MQTT not connected');
            return;
        }
        const payload = {
            thread_id: threadId,
            activity_status: isTyping ? '1' : '0',
            client_context: Date.now().toString(),
        };
        const topic = '/ig_typing_indicator';
        const payloadStr = JSON.stringify(payload);
        const publishPacket = this.buildPublishPacket(topic, payloadStr);
        this.ws.send(publishPacket);
        logger(`✅ Typing ${isTyping ? 'started' : 'stopped'}`);
    }
    buildPublishPacket(topic, payload) {
        const topicBytes = Buffer.from(topic, 'utf8');
        const payloadBytes = Buffer.from(payload, 'utf8');
        const topicLength = Buffer.from([(topicBytes.length >> 8) & 0xff, topicBytes.length & 0xff]);
        const remainingLength = 2 + topicBytes.length + payloadBytes.length;
        const fixedHeader = Buffer.from([0x30, remainingLength]);
        return Buffer.concat([fixedHeader, topicLength, topicBytes, payloadBytes]);
    }
    on(topic, callback) {
        if (!this.subscriptions.has(topic)) {
            this.subscriptions.set(topic, []);
        }
        this.subscriptions.get(topic).push(callback);
    }
    off(topic, callback) {
        if (!callback) {
            this.subscriptions.delete(topic);
        }
        else {
            const handlers = this.subscriptions.get(topic);
            if (handlers) {
                const index = handlers.indexOf(callback);
                if (index > -1) {
                    handlers.splice(index, 1);
                }
            }
        }
    }
    async disconnect() {
        this.cleanup();
        if (this.reconnectInterval) {
            clearInterval(this.reconnectInterval);
            this.reconnectInterval = null;
        }
        if (this.ws) {
            return new Promise(resolve => {
                this.ws.once('close', () => {
                    logger('MQTT disconnected');
                    resolve();
                });
                this.ws.close();
            });
        }
    }
    isConnected() {
        var _a;
        return ((_a = this.ws) === null || _a === void 0 ? void 0 : _a.readyState) === 1;
    }
}
exports.InstagramMqttClient = InstagramMqttClient;
//# sourceMappingURL=mqtt-client.js.map