import { IgApiClient } from './client';
export interface CookieFormat {
    name?: string;
    key?: string;
    value: string;
    domain?: string;
    path?: string;
    secure?: boolean;
    httpOnly?: boolean;
    sameSite?: string;
    expirationDate?: number;
}
export declare class CookieLoader {
    private client;
    private cookieFile;
    constructor(client: IgApiClient, cookieFile: string);
    loadFromFile(): Promise<boolean>;
    private parseNetscapeCookies;
    private importCookies;
}
