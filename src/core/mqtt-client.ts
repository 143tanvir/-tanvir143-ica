import * as tls from 'tls';
import * as zlib from 'zlib';
import debug from 'debug';
import { IgApiClient } from './client';

const logger = debug('ig:mqtt');

export interface MqttConfig {
  host?: string;
  topics?: string[];
}

const REALTIME_HOST = 'edge-mqtt.facebook.com';
const REALTIME_PORT = 443;
const REALTIME_APP_ID = 567067343352427;

const DEFAULT_TOPIC_IDS = [
  88,
  135,
  149,
  150,
  133,
  146
];

const TOPIC_ALIASES: Record<string, number> = {
  '/pubsub': 88,
  '/ig_foreground_state': 102,
  '/ig_send_message': 132,
  '/ig_send_message_response': 133,
  '/ig_sub_iris': 134,
  '/ig_sub_iris_response': 135,
  '/ig_message_sync': 146,
  '/ig_realtime_sub': 149,
  '/ig_region_hint': 150
};

const THRIFT = {
  STOP: 0x00,
  TRUE: 0x01,
  FALSE: 0x02,
  BYTE: 0x03,
  INT16: 0x04,
  INT32: 0x05,
  INT64: 0x06,
  BINARY: 0x08,
  LIST: 0x09,
  MAP: 0x0b,
  STRUCT: 0x0c
};

type ThriftDescriptor = {
  name: string;
  field: number;
  type: number;
  children?: ThriftDescriptor[];
};

class ThriftWriter {
  private buffer: number[] = [];
  private fieldStack: number[] = [];
  private currentField = 0;

  writeStop(): void {
    this.buffer.push(THRIFT.STOP);

    if (this.fieldStack.length > 0) {
      this.currentField =
        this.fieldStack.pop() as number;
    }
  }

  writeField(
    field: number,
    fieldType: number
  ): void {
    const delta =
      field - this.currentField;

    const type =
      fieldType & 0x0f;

    if (
      delta > 0 &&
      delta <= 15
    ) {
      this.buffer.push(
        (delta << 4) | type
      );
    } else {
      this.buffer.push(type);

      this.writeVarInt(
        this.zigZag(field, 16)
      );
    }

    this.currentField = field;
  }

  writeVarInt(
    value: number
  ): void {
    let current =
      Math.floor(
        Math.max(0, value)
      );

    do {
      let byte =
        current % 128;

      current =
        Math.floor(
          current / 128
        );

      if (current !== 0) {
        byte |= 0x80;
      }

      this.buffer.push(byte);
    } while (
      current !== 0
    );
  }

  writeStringDirect(
    value: string
  ): void {
    const raw =
      Buffer.from(
        String(value),
        'utf8'
      );

    this.writeVarInt(
      raw.length
    );

    for (
      let i = 0;
      i < raw.length;
      i += 1
    ) {
      this.buffer.push(
        raw[i]
      );
    }
  }

  writeString(
    field: number,
    value: string
  ): void {
    this.writeField(
      field,
      THRIFT.BINARY
    );

    this.writeStringDirect(
      value
    );
  }

  writeBoolean(
    field: number,
    value: boolean
  ): void {
    this.writeField(
      field,
      value
        ? THRIFT.TRUE
        : THRIFT.FALSE
    );
  }

  writeInt(
    field: number,
    value: number,
    bits: number
  ): void {
    const type =
      bits === 8
        ? THRIFT.BYTE
        : bits === 16
          ? THRIFT.INT16
          : bits === 32
            ? THRIFT.INT32
            : THRIFT.INT64;

    this.writeField(
      field,
      type
    );

    if (bits === 8) {
      const b =
        Buffer.alloc(1);

      b.writeInt8(value, 0);

      this.buffer.push(
        b[0]
      );

      return;
    }

    this.writeVarInt(
      this.zigZag(
        value,
        bits
      )
    );
  }

  writeIntList(
    field: number,
    values: number[]
  ): void {
    this.writeField(
      field,
      THRIFT.LIST
    );

    const size =
      values.length;

    if (size < 15) {
      this.buffer.push(
        (size << 4) |
          THRIFT.INT32
      );
    } else {
      this.buffer.push(
        0xf0 |
          THRIFT.INT32
      );

      this.writeVarInt(
        size
      );
    }

    for (
      const value of values
    ) {
      this.writeVarInt(
        this.zigZag(
          value,
          32
        )
      );
    }
  }

  writeBinaryMap(
    field: number,
    values: Record<
      string,
      string
    >
  ): void {
    this.writeField(
      field,
      THRIFT.MAP
    );

    const entries =
      Object.keys(values);

    this.writeVarInt(
      entries.length
    );

    if (
      entries.length === 0
    ) {
      return;
    }

    this.buffer.push(
      (THRIFT.BINARY << 4) |
        THRIFT.BINARY
    );

    for (
      const key of entries
    ) {
      this.writeStringDirect(
        key
      );

      this.writeStringDirect(
        values[key]
      );
    }
  }

  pushStruct(
    field: number
  ): void {
    this.writeField(
      field,
      THRIFT.STRUCT
    );

    this.fieldStack.push(
      this.currentField
    );

    this.currentField = 0;
  }

  toBuffer(): Buffer {
    return Buffer.from(
      this.buffer
    );
  }

  private zigZag(
    value: number,
    bits: number
  ): number {
    if (bits === 64) {
      if (value >= 0) {
        return value * 2;
      }

      return (
        -value * 2
      ) - 1;
    }

    if (value >= 0) {
      return value * 2;
    }

    return (
      -value * 2
    ) - 1;
  }
}

class ThriftEncoder {
  static encodeConnection(
    connection: any
  ): Buffer {
    const writer =
      new ThriftWriter();

    this.writeStruct(
      writer,
      connection,
      this.connectionDescriptors()
    );

    writer.writeStop();

    return writer.toBuffer();
  }

  private static writeStruct(
    writer: ThriftWriter,
    data: any,
    descriptors: ThriftDescriptor[]
  ): void {
    for (
      const descriptor of descriptors
    ) {
      const value =
        data[descriptor.name];

      if (
        value === undefined ||
        value === null
      ) {
        continue;
      }

      switch (
        descriptor.type
      ) {
        case THRIFT.BINARY:
          writer.writeString(
            descriptor.field,
            String(value)
          );
          break;

        case THRIFT.TRUE:
        case THRIFT.FALSE:
          writer.writeBoolean(
            descriptor.field,
            Boolean(value)
          );
          break;
          
       case THRIFT.BYTE:
         writer.writeInt(
           descriptor.field,
           Number(value),
           8
        );
         break;
        case THRIFT.INT16:
          writer.writeInt(
            descriptor.field,
            Number(value),
            16
          );
          break;

        case THRIFT.INT32:
          writer.writeInt(
            descriptor.field,
            Number(value),
            32
          );
          break;

        case THRIFT.INT64:
          writer.writeInt(
            descriptor.field,
            Number(value),
            64
          );
          break;

        case THRIFT.LIST:
          writer.writeIntList(
            descriptor.field,
            Array.isArray(value)
              ? value.map(Number)
              : []
          );
          break;

        case THRIFT.STRUCT:
          writer.pushStruct(
            descriptor.field
          );

          this.writeStruct(
            writer,
            value,
            descriptor.children || []
          );

          writer.writeStop();
          break;

        case THRIFT.MAP:
          writer.writeBinaryMap(
            descriptor.field,
            value
          );
          break;

        default:
          throw new Error(
            `Unsupported Thrift field type: ${descriptor.type}`
          );
      }
    }
  }

  private static connectionDescriptors():
    ThriftDescriptor[] {
    return [
      {
        name: 'clientIdentifier',
        field: 1,
        type: THRIFT.BINARY
      },
      {
        name: 'willTopic',
        field: 2,
        type: THRIFT.BINARY
      },
      {
        name: 'willMessage',
        field: 3,
        type: THRIFT.BINARY
      },
      {
        name: 'clientInfo',
        field: 4,
        type: THRIFT.STRUCT,
        children: [
          {
            name: 'userId',
            field: 1,
            type: THRIFT.INT64
          },
          {
            name: 'userAgent',
            field: 2,
            type: THRIFT.BINARY
          },
          {
            name: 'clientCapabilities',
            field: 3,
            type: THRIFT.INT64
          },
          {
            name: 'endpointCapabilities',
            field: 4,
            type: THRIFT.INT64
          },
          {
            name: 'publishFormat',
            field: 5,
            type: THRIFT.INT32
          },
          {
            name: 'noAutomaticForeground',
            field: 6,
            type: THRIFT.FALSE
          },
          {
            name: 'makeUserAvailableInForeground',
            field: 7,
            type: THRIFT.TRUE
          },
          {
            name: 'deviceId',
            field: 8,
            type: THRIFT.BINARY
          },
          {
            name: 'isInitiallyForeground',
            field: 9,
            type: THRIFT.TRUE
          },
          {
            name: 'networkType',
            field: 10,
            type: THRIFT.INT32
          },
          {
            name: 'networkSubtype',
            field: 11,
            type: THRIFT.INT32
          },
          {
            name: 'clientMqttSessionId',
            field: 12,
            type: THRIFT.INT64
          },
          {
            name: 'clientIpAddress',
            field: 13,
            type: THRIFT.BINARY
          },
          {
            name: 'subscribeTopics',
            field: 14,
            type: THRIFT.LIST
          },
          {
            name: 'clientType',
            field: 15,
            type: THRIFT.BINARY
          },
          {
            name: 'appId',
            field: 16,
            type: THRIFT.INT64
          },
          {
            name: 'overrideNectarLogging',
            field: 17,
            type: THRIFT.FALSE
          },
          {
            name: 'connectTokenHash',
            field: 18,
            type: THRIFT.BINARY
          },
          {
            name: 'regionPreference',
            field: 19,
            type: THRIFT.BINARY
          },
          {
            name: 'deviceSecret',
            field: 20,
            type: THRIFT.BINARY
          },
          {
            name: 'clientStack',
            field: 21,
            type: THRIFT.BYTE
          }
        ]
      },
      {
        name: 'password',
        field: 5,
        type: THRIFT.BINARY
      },
      {
        name: 'getDiffsRequests',
        field: 6,
        type: THRIFT.LIST
      },
      {
        name: 'zeroRatingTokenHash',
        field: 9,
        type: THRIFT.BINARY
      },
      {
        name: 'appSpecificInfo',
        field: 10,
        type: THRIFT.MAP
      }
    ];
  }
}

type ParsedPacket = {
  type: number;
  flags: number;
  body: Buffer;
};

export class InstagramMqttClient {
  private ws:
    tls.TLSSocket | null = null;

  private subscriptions:
    Map<string, Function[]> =
      new Map();

  private reconnectInterval:
    NodeJS.Timeout | null = null;

  private heartbeatInterval:
    NodeJS.Timeout | null = null;

  private isConnecting = false;

  private receiveBuffer:
    Buffer = Buffer.alloc(0);

  private connectionPromiseResolve:
    (() => void) | null = null;

  private connectionPromiseReject:
    ((error: Error) => void) | null = null;

  private connectionTimeout:
    NodeJS.Timeout | null = null;

  private manualDisconnect =
    false;

  private reconnectDelay =
    5000;

  private directSubscriptionStarted =
    false;

  constructor(
    private ig: IgApiClient
  ) {}

  async connect(
    config?: Partial<MqttConfig>
  ): Promise<void> {
    if (
      this.isConnecting ||
      this.ws?.authorized
    ) {
      logger(
        'Already connected or connecting'
      );

      return;
    }

    this.isConnecting = true;
    this.manualDisconnect = false;

    const host =
      config?.host ||
      REALTIME_HOST;

    try {
      const cookies =
        await this.ig.state.cookieJar.getCookies(
          'https://www.instagram.com'
        );

      const sessionCookie =
        cookies.find(
          cookie =>
            cookie.key ===
            'sessionid'
        );

      if (
        !sessionCookie?.value
      ) {
        throw new Error(
          'Missing sessionid cookie for MQTT realtime'
        );
      }

      const sessionId =
        sessionCookie.value;

      const deviceId =
        this.ig.state.phoneId ||
        this.ig.state.uuid;

      if (!deviceId) {
        throw new Error(
          'Missing Instagram device id for MQTT realtime'
        );
      }

      const userId =
        Number(
          this.ig.state.cookieUserId
        );

      if (
        !Number.isFinite(userId) ||
        userId <= 0
      ) {
        throw new Error(
          'Missing authenticated Instagram user id for MQTT realtime'
        );
      }

      const topics =
        this.resolveTopicIds(
          config?.topics
        );

      const connectionPayload =
        {
          clientIdentifier:
            String(deviceId)
              .substring(0, 20),

          clientInfo: {
            userId,

            userAgent:
              this.ig.state
                .appUserAgent,

            clientCapabilities: 183,

            endpointCapabilities: 0,

            publishFormat: 1,

            noAutomaticForeground:
              false,

            makeUserAvailableInForeground:
              true,

            deviceId:
              String(deviceId),

            isInitiallyForeground:
              true,

            networkType: 1,

            networkSubtype: 0,

            clientMqttSessionId:
              Date.now() %
              0x100000000,

            subscribeTopics:
              topics,

            clientType:
              'cookie_auth',

            appId:
              REALTIME_APP_ID,

            deviceSecret:
              '',

            clientStack: 3
          },

          password:
            `sessionid=${sessionId}`,

          getDiffsRequests: [],

          appSpecificInfo: {
            app_version:
              this.ig.state
                .appVersion,

            'X-IG-Capabilities':
              this.ig.state
                .capabilitiesHeader,

            everclear_subscriptions:
              JSON.stringify({
                inapp_notification_subscribe_comment:
                  '17899377895239777',

                inapp_notification_subscribe_comment_mention_and_reply:
                  '17899377895239777',

                video_call_participant_state_delivery:
                  '17977239895057311',

                presence_subscribe:
                  '17846944882223835'
              }),

            'User-Agent':
              this.ig.state
                .appUserAgent,

            'Accept-Language':
              this.ig.state.language
                .replace(
                  '_',
                  '-'
                ),

            platform:
              'android',

            ig_mqtt_route:
              'django',

            pubsub_msg_type_blacklist:
              'direct, typing_type',

            auth_cache_enabled:
              '0'
          }
        };

      const thriftPayload =
        ThriftEncoder.encodeConnection(
          connectionPayload
        );

      const compressedPayload =
        zlib.deflateSync(
          thriftPayload,
          {
            level: 9
          }
        );

      const connectPacket =
        this.buildConnectPacket(
          compressedPayload,
          20
        );

      logger(
        `Connecting MQTToT to ${host}:${REALTIME_PORT}`
      );

      this.receiveBuffer =
        Buffer.alloc(0);

      return await new Promise<void>(
        (
          resolve,
          reject
        ) => {
          this.connectionPromiseResolve =
            resolve;

          this.connectionPromiseReject =
            reject;

          this.connectionTimeout =
            setTimeout(
              () => {
                this.finishConnectionError(
                  new Error(
                    'MQTToT connection timeout'
                  )
                );
              },
              20000
            );

          this.ws =
            tls.connect(
              {
                host,

                port:
                  REALTIME_PORT,

                servername:
                  host,

                rejectUnauthorized:
                  true
              },

              () => {
                logger(
                  'TLS connection established'
                );

                try {
                  this.ws!.write(
                    connectPacket
                  );

                  logger(
                    `MQTToT CONNECT sent (${connectPacket.length} bytes)`
                  );
                } catch (
                  error
                ) {
                  this.finishConnectionError(
                    error instanceof Error
                      ? error
                      : new Error(
                          String(error)
                        )
                  );
                }
              }
            );

          this.ws.on(
            'data',
            (data: Buffer) => {
              this.handleSocketData(
                Buffer.from(data)
              );
            }
          );

          this.ws.on(
            'error',
            (error: Error) => {
              logger(
                'MQTToT error:',
                error.message
              );

              if (
                this.isConnecting
              ) {
                this.finishConnectionError(
                  error
                );
              }
            }
          );

          this.ws.on(
            'close',
            () => {
              logger(
                'MQTToT disconnected'
              );

              this.cleanup();

              if (
                this.isConnecting
              ) {
                this.finishConnectionError(
                  new Error(
                    'MQTToT socket closed before CONNACK'
                  )
                );
              }

              if (
                !this.manualDisconnect
              ) {
                this.setupReconnect();
              }
            }
          );

          this.ws.on(
            'end',
            () => {
              logger(
                'MQTToT stream ended'
              );
            }
          );
        }
      );
    } catch (
      error
    ) {
      this.isConnecting = false;

      this.rejectConnection(
        error instanceof Error
          ? error
          : new Error(
              String(error)
            )
      );

      throw error;
    }
  }

  private resolveTopicIds(
    topics?: string[]
  ): number[] {
    if (
      !topics ||
      topics.length === 0
    ) {
      return DEFAULT_TOPIC_IDS.slice();
    }

    const resolved:
      number[] = [];

    for (
      const topic of topics
    ) {
      const trimmed =
        String(topic).trim();

      if (
        /^\d+$/.test(
          trimmed
        )
      ) {
        resolved.push(
          Number(trimmed)
        );

        continue;
      }

      const id =
        TOPIC_ALIASES[
          trimmed
        ];

      if (
        id !== undefined
      ) {
        resolved.push(id);
      }
    }

    if (
      resolved.length === 0
    ) {
      return DEFAULT_TOPIC_IDS.slice();
    }

    return Array.from(
      new Set(resolved)
    );
  }

  private finishConnectionSuccess(): void {
    if (
      !this.isConnecting
    ) {
      return;
    }

    this.isConnecting =
      false;

    if (
      this.connectionTimeout
    ) {
      clearTimeout(
        this.connectionTimeout
      );

      this.connectionTimeout =
        null;
    }

    const resolve =
      this.connectionPromiseResolve;

    this.connectionPromiseResolve =
      null;

    this.connectionPromiseReject =
      null;

    this.setupHeartbeat();
    this.setupReconnect();

    /*
     * Connecting to the broker is not enough for
     * Direct Message realtime events. Instagram
     * requires an Iris/direct subscription carrying
     * the current inbox sequence state.
     */
    void this.subscribeToDirectMessages();

    if (resolve) {
      resolve();
    }
  }

  private finishConnectionError(
    error: Error
  ): void {
    if (
      this.connectionTimeout
    ) {
      clearTimeout(
        this.connectionTimeout
      );

      this.connectionTimeout =
        null;
    }

    this.isConnecting =
      false;

    const reject =
      this.connectionPromiseReject;

    this.connectionPromiseResolve =
      null;

    this.connectionPromiseReject =
      null;

    if (reject) {
      reject(error);
    }
  }

  private rejectConnection(
    error: Error
  ): void {
    if (
      this.connectionPromiseReject
    ) {
      const reject =
        this.connectionPromiseReject;

      this.connectionPromiseResolve =
        null;

      this.connectionPromiseReject =
        null;

      reject(error);
    }
  }

  private buildConnectPacket(
    payload: Buffer,
    keepAlive: number
  ): Buffer {
    const protocolName =
      Buffer.from(
        'MQTToT',
        'utf8'
      );

    const variableHeader =
      Buffer.concat([
        Buffer.from([
          (protocolName.length >> 8) &
            0xff,

          protocolName.length &
            0xff
        ]),

        protocolName,

        Buffer.from([
          3,
          0xc2
        ]),

        Buffer.from([
          (keepAlive >> 8) &
            0xff,

          keepAlive & 0xff
        ])
      ]);

    const body =
      Buffer.concat([
        variableHeader,
        payload
      ]);

    return Buffer.concat([
      Buffer.from([
        0x10
      ]),

      this.encodeRemainingLength(
        body.length
      ),

      body
    ]);
  }

  private handleSocketData(
    chunk: Buffer
  ): void {
    this.receiveBuffer =
      Buffer.concat([
        this.receiveBuffer,
        chunk
      ]);

    while (true) {
      const packet =
        this.readNextPacket();

      if (!packet) {
        break;
      }

      this.handlePacket(
        packet
      );
    }
  }

  private readNextPacket():
    | ParsedPacket
    | null {
    if (
      this.receiveBuffer.length <
      2
    ) {
      return null;
    }

    let multiplier = 1;
    let remainingLength = 0;
    let position = 1;

    while (true) {
      if (
        position >=
        this.receiveBuffer.length
      ) {
        return null;
      }

      const byte =
        this.receiveBuffer[
          position
        ];

      remainingLength +=
        (byte & 127) *
        multiplier;

      if (
        (byte & 128) === 0
      ) {
        break;
      }

      multiplier *= 128;

      if (
        multiplier >
        128 * 128 * 128
      ) {
        throw new Error(
          'Invalid MQTT remaining length'
        );
      }

      position += 1;
    }

    const totalLength =
      position +
      1 +
      remainingLength;

    if (
      this.receiveBuffer.length <
      totalLength
    ) {
      return null;
    }

    const firstByte =
      this.receiveBuffer[0];

    const bodyStart =
      position + 1;

    const bodyEnd =
      bodyStart +
      remainingLength;

    const body =
      this.receiveBuffer.slice(
        bodyStart,
        bodyEnd
      );

    this.receiveBuffer =
      this.receiveBuffer.slice(
        totalLength
      );

    return {
      type:
        (firstByte >> 4) &
        0x0f,

      flags:
        firstByte & 0x0f,

      body
    };
  }

  private handlePacket(
    packet: ParsedPacket
  ): void {
    switch (
      packet.type
    ) {
      case 2:
        this.handleConnack(
          packet.body
        );
        return;

      case 3:
        this.handlePublish(
          packet.flags,
          packet.body
        );
        return;

      case 8:
        logger(
          'SUBSCRIBE packet received'
        );
        return;

      case 9:
        logger(
          'SUBACK received'
        );
        return;

      case 13:
        logger(
          'PINGRESP received'
        );
        return;

      case 14:
        logger(
          'MQTT DISCONNECT received'
        );

        if (this.ws) {
          this.ws.end();
        }

        return;

      default:
        logger(
          `MQTToT packet type ${packet.type}`
        );
    }
  }

  private handleConnack(
    body: Buffer
  ): void {
    if (
      body.length < 2
    ) {
      this.finishConnectionError(
        new Error(
          'Invalid MQTT CONNACK packet'
        )
      );

      return;
    }

    const returnCode =
      body[1];

    logger(
      `CONNACK received, return code: ${returnCode}`
    );

    if (
      returnCode !== 0
    ) {
      this.finishConnectionError(
        new Error(
          `MQTToT authentication failed (return code ${returnCode})`
        )
      );

      return;
    }

    logger(
      'MQTToT authenticated'
    );

    this.finishConnectionSuccess();
  }

  /**
   * Fetch the current Direct inbox sync state
   * and subscribe to Instagram Iris updates.
   */
  private async subscribeToDirectMessages():
    Promise<void> {
    if (
      this.directSubscriptionStarted
    ) {
      return;
    }

    if (
      !this.isConnected()
    ) {
      return;
    }

    try {
      const feed =
        this.ig.feed.directInbox();

      const response: any =
        await feed.request();

      const inbox =
        response?.inbox ||
        response;

      const seqId =
        inbox?.seq_id ??
        response?.seq_id;

      const snapshotAtMs =
        inbox?.snapshot_at_ms ??
        response?.snapshot_at_ms;

      if (
        seqId === undefined ||
        snapshotAtMs === undefined
      ) {
        logger(
          'Direct inbox did not provide realtime sync state'
        );

        return;
      }

      const payload =
        JSON.stringify({
          seq_id:
            Number(seqId),

          snapshot_at_ms:
            Number(snapshotAtMs),

          snapshot_app_version:
            this.ig.state.appVersion
        });

      const compressed =
        zlib.deflateSync(
          Buffer.from(
            payload,
            'utf8'
          )
        );

      const packet =
        this.buildPublishPacket(
          '/ig_sub_iris',
          compressed,
          0
        );

      this.ws!.write(
        packet
      );

      this.directSubscriptionStarted =
        true;

      logger(
        `Direct realtime subscription sent: seq_id=${seqId}`
      );
    } catch (
      error
    ) {
      logger(
        'Failed to subscribe to Direct realtime:',
        error instanceof Error
          ? error.message
          : error
      );
    }
  }

  private handlePublish(
    flags: number,
    body: Buffer
  ): void {
    try {
      if (
        body.length < 2
      ) {
        return;
      }

      let pos = 0;

      const topicLength =
        (body[pos] << 8) |
        body[pos + 1];

      pos += 2;

      if (
        pos + topicLength >
        body.length
      ) {
        logger(
          'Invalid MQTT PUBLISH topic length'
        );

        return;
      }

      const topic =
        body
          .slice(
            pos,
            pos + topicLength
          )
          .toString('utf8');

      pos += topicLength;

      const qos =
        (flags >> 1) &
        0x03;

      let packetId:
        number | null = null;

      if (
        qos > 0
      ) {
        if (
          pos + 2 >
          body.length
        ) {
          return;
        }

        packetId =
          (body[pos] << 8) |
          body[pos + 1];

        pos += 2;
      }

      const payload =
        body.slice(pos);

      logger(
        `PUBLISH topic=${topic} bytes=${payload.length}`
      );

      if (
        qos === 1 &&
        packetId !== null
      ) {
        this.sendPubAck(
          packetId
        );
      }

      const uncompressed =
        this.tryDecompress(
          payload
        );

      const parsed =
        this.parsePayload(
          uncompressed
        );

      if (
        parsed !== undefined
      ) {
        this.triggerHandlers(
          topic,
          parsed
        );

        this.triggerHandlers(
          '*',
          {
            topic,
            data: parsed
          }
        );

        const numericTopic =
          Number(topic);

        if (
          Number.isFinite(
            numericTopic
          )
        ) {
          const aliases =
            Object.keys(
              TOPIC_ALIASES
            ).filter(
              alias =>
                TOPIC_ALIASES[
                  alias
                ] === numericTopic
            );

          for (
            const alias of aliases
          ) {
            this.triggerHandlers(
              alias,
              parsed
            );
          }
        }
      } else {
        this.triggerHandlers(
          topic,
          {
            raw: uncompressed
          }
        );

        this.triggerHandlers(
          '*',
          {
            topic,
            data: uncompressed
          }
        );

        logger(
          `Non-JSON MQTT payload on ${topic}: ${uncompressed
            .toString('utf8')
            .slice(0, 250)}`
        );
      }
    } catch (
      error
    ) {
      logger(
        'Error parsing MQTT PUBLISH:',
        error
      );
    }
  }

  private parsePayload(
    payload: Buffer
  ): any | undefined {
    if (
      !payload.length
    ) {
      return undefined;
    }

    const text =
      payload
        .toString('utf8')
        .trim();

    if (!text) {
      return undefined;
    }

    try {
      return JSON.parse(
        text
      );
    } catch (_) {
      const cleaned =
        text.charCodeAt(0) ===
        0xfeff
          ? text.slice(1)
          : text;

      try {
        return JSON.parse(
          cleaned
        );
      } catch (_) {
        return undefined;
      }
    }
  }

  private tryDecompress(
    payload: Buffer
  ): Buffer {
    if (
      !payload.length
    ) {
      return payload;
    }

    if (
      payload[0] === 0x78
    ) {
      try {
        return zlib.inflateSync(
          payload
        );
      } catch (_) {
        try {
          return zlib.inflateRawSync(
            payload
          );
        } catch (_) {
          return payload;
        }
      }
    }

    try {
      const inflated =
        zlib.inflateRawSync(
          payload
        );

      if (
        inflated.length > 0
      ) {
        return inflated;
      }
    } catch (_) {
      // Not compressed.
    }

    return payload;
  }

  private sendPubAck(
    packetId: number
  ): void {
    if (
      !this.isConnected()
    ) {
      return;
    }

    const packet =
      Buffer.from([
        0x40,
        0x02,

        (packetId >> 8) &
          0xff,

        packetId & 0xff
      ]);

    this.ws!.write(
      packet
    );
  }

  private setupHeartbeat(): void {
    if (
      this.heartbeatInterval
    ) {
      clearInterval(
        this.heartbeatInterval
      );
    }

    this.heartbeatInterval =
      setInterval(
        () => {
          if (
            this.isConnected()
          ) {
            try {
              this.ws!.write(
                Buffer.from([
                  0xc0,
                  0x00
                ])
              );

              logger(
                'PINGREQ sent'
              );
            } catch (
              error
            ) {
              logger(
                'Failed to send PINGREQ:',
                error
              );
            }
          }
        },
        15000
      );
  }

  private setupReconnect(): void {
    if (
      this.manualDisconnect
    ) {
      return;
    }

    if (
      this.reconnectInterval
    ) {
      return;
    }

    this.reconnectInterval =
      setInterval(
        () => {
          if (
            !this.isConnected() &&
            !this.isConnecting &&
            !this.manualDisconnect
          ) {
            logger(
              'Reconnecting MQTToT...'
            );

            this.connect().catch(
              error => {
                logger(
                  'Reconnect failed:',
                  error.message
                );
              }
            );
          }
        },
        this.reconnectDelay
      );
  }

  private cleanup(): void {
    if (
      this.heartbeatInterval
    ) {
      clearInterval(
        this.heartbeatInterval
      );

      this.heartbeatInterval =
        null;
    }

    this.receiveBuffer =
      Buffer.alloc(0);

    this.directSubscriptionStarted =
      false;
  }

  private encodeRemainingLength(
    length: number
  ): Buffer {
    const bytes: number[] =
      [];

    let value =
      Math.max(
        0,
        Math.floor(length)
      );

    do {
      let encoded =
        value % 128;

      value =
        Math.floor(
          value / 128
        );

      if (
        value > 0
      ) {
        encoded |= 0x80;
      }

      bytes.push(
        encoded
      );
    } while (
      value > 0
    );

    return Buffer.from(
      bytes
    );
  }

  private buildPublishPacket(
    topic: string,
    payload: string | Buffer,
    qos: number = 0
  ): Buffer {
    const topicBytes =
      Buffer.from(
        topic,
        'utf8'
      );

    const payloadBytes =
      Buffer.isBuffer(payload)
        ? payload
        : Buffer.from(
            payload,
            'utf8'
          );

    const topicLength =
      Buffer.from([
        (topicBytes.length >> 8) &
          0xff,

        topicBytes.length &
          0xff
      ]);

    let packetId =
      Buffer.alloc(0);

    let flags =
      0x00;

    if (
      qos === 1
    ) {
      flags = 0x02;

      const id =
        (
          Math.floor(
            Math.random() *
              65535
          ) + 1
        ) & 0xffff;

      packetId =
        Buffer.from([
          (id >> 8) &
            0xff,

          id & 0xff
        ]);
    }

    const body =
      Buffer.concat([
        topicLength,
        topicBytes,
        packetId,
        payloadBytes
      ]);

    return Buffer.concat([
      Buffer.from([
        0x30 | flags
      ]),

      this.encodeRemainingLength(
        body.length
      ),

      body
    ]);
  }

  public sendTypingIndicator(
    threadId: string,
    isTyping: boolean = true
  ): void {
    if (
      !this.isConnected()
    ) {
      logger(
        'MQTT not connected'
      );

      return;
    }

    const payload = {
      thread_id:
        String(threadId),

      activity_status:
        isTyping
          ? '1'
          : '0',

      client_context:
        Date.now().toString()
    };

    const packet =
      this.buildPublishPacket(
        '/ig_typing_indicator',
        JSON.stringify(
          payload
        ),
        0
      );

    try {
      this.ws!.write(
        packet
      );

      logger(
        `Typing ${
          isTyping
            ? 'started'
            : 'stopped'
        }`
      );
    } catch (
      error
    ) {
      logger(
        'Failed to send typing indicator:',
        error
      );
    }
  }

  on(
    topic: string,
    callback: Function
  ): void {
    if (
      !this.subscriptions.has(
        topic
      )
    ) {
      this.subscriptions.set(
        topic,
        []
      );
    }

    this.subscriptions
      .get(topic)!
      .push(callback);
  }

  off(
    topic: string,
    callback?: Function
  ): void {
    if (!callback) {
      this.subscriptions.delete(
        topic
      );

      return;
    }

    const handlers =
      this.subscriptions.get(
        topic
      );

    if (!handlers) {
      return;
    }

    const index =
      handlers.indexOf(
        callback
      );

    if (
      index !== -1
    ) {
      handlers.splice(
        index,
        1
      );
    }

    if (
      handlers.length === 0
    ) {
      this.subscriptions.delete(
        topic
      );
    }
  }

  private triggerHandlers(
    topic: string,
    data: any
  ): void {
    const handlers =
      this.subscriptions.get(
        topic
      );

    if (!handlers) {
      return;
    }

    for (
      const handler of
      handlers.slice()
    ) {
      try {
        handler(data);
      } catch (
        error
      ) {
        logger(
          'MQTT handler error:',
          error
        );
      }
    }
  }

  async disconnect(): Promise<void> {
    this.manualDisconnect =
      true;

    if (
      this.reconnectInterval
    ) {
      clearInterval(
        this.reconnectInterval
      );

      this.reconnectInterval =
        null;
    }

    this.cleanup();

    if (
      this.connectionTimeout
    ) {
      clearTimeout(
        this.connectionTimeout
      );

      this.connectionTimeout =
        null;
    }

    this.isConnecting =
      false;

    this.connectionPromiseResolve =
      null;

    this.connectionPromiseReject =
      null;

    if (!this.ws) {
      return;
    }

    const socket =
      this.ws;

    this.ws = null;

    await new Promise<void>(
      resolve => {
        let settled = false;

        const done =
          () => {
            if (settled) {
              return;
            }

            settled = true;
            resolve();
          };

        socket.once(
          'close',
          done
        );

        socket.once(
          'end',
          done
        );

        try {
          socket.end(
            Buffer.from([
              0xe0,
              0x00
            ])
          );
        } catch (_) {
          done();
        }

        setTimeout(
          () => {
            try {
              socket.destroy();
            } catch (_) {
              // Ignore.
            }

            done();
          },
          2000
        );
      }
    );

    logger(
      'MQTToT disconnected'
    );
  }

  isConnected(): boolean {
    return Boolean(
      this.ws &&
      !this.ws.destroyed &&
      this.ws.authorized
    );
  }
}
