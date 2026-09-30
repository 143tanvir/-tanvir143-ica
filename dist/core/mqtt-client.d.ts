import { IgApiClient } from './client';
export interface MqttConfig {
    host?: string;
    topics?: string[];
}
export declare class InstagramMqttClient {
    private ig;
    private ws;
    private subscriptions;
    private reconnectInterval;
    private isConnecting;
    private heartbeatInterval;
    private sessionId;
    constructor(ig: IgApiClient);
    connect(config?: Partial<MqttConfig>): Promise<void>;
    private generateClientId;
    private sendConnectPacket;
    private subscribeToMessages;
    private buildSubscribePacket;
    private setupHeartbeat;
    private cleanup;
    private setupReconnect;
    private handleMessage;
    private triggerHandlers;
    sendTypingIndicator(threadId: string, isTyping?: boolean): void;
    private buildPublishPacket;
    on(topic: string, callback: Function): void;
    off(topic: string, callback?: Function): void;
    disconnect(): Promise<void>;
    isConnected(): boolean;
}
