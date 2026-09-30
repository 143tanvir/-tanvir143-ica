"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CookieLoader = void 0;
const fs = require("fs");
const path = require("path");
const debug_1 = require("debug");
const logger = (0, debug_1.default)('ig:cookie-loader');
class CookieLoader {
    constructor(client, cookieFile) {
        this.client = client;
        this.cookieFile = cookieFile;
    }
    async loadFromFile() {
        try {
            const filePath = path.resolve(this.cookieFile);
            if (!fs.existsSync(filePath)) {
                logger(`Cookie file not found: ${filePath}`);
                return false;
            }
            const fileContent = fs.readFileSync(filePath, 'utf-8');
            const ext = path.extname(filePath).toLowerCase();
            let cookies;
            if (ext === '.json') {
                cookies = JSON.parse(fileContent);
            }
            else if (ext === '.txt') {
                cookies = this.parseNetscapeCookies(fileContent);
            }
            else {
                logger(`Unsupported file format: ${ext}`);
                return false;
            }
            return await this.importCookies(cookies);
        }
        catch (error) {
            logger(`Failed to load cookies from ${this.cookieFile}:`, error.message);
            return false;
        }
    }
    parseNetscapeCookies(content) {
        const cookies = [];
        const lines = content.split('\n');
        for (const line of lines) {
            if (line.trim().startsWith('#') || !line.trim())
                continue;
            const parts = line.split('\t');
            if (parts.length >= 7) {
                cookies.push({
                    name: parts[5],
                    value: parts[6],
                    domain: parts[0],
                    path: parts[2],
                    secure: parts[3] === 'TRUE',
                    httpOnly: false,
                    expirationDate: parseInt(parts[4], 10),
                });
            }
        }
        return cookies;
    }
    async importCookies(cookies) {
        const jar = this.client.state.cookieJar;
        const baseUrl = 'https://www.instagram.com/';
        let loadedCount = 0;
        for (const c of cookies) {
            const name = c.name || c.key;
            const value = c.value;
            if (!name || !value)
                continue;
            const cookieStr = `${name}=${value}; Domain=${c.domain || '.instagram.com'}; Path=${c.path || '/'}${c.secure ? '; Secure' : ''}${c.httpOnly ? '; HttpOnly' : ''}`;
            try {
                await jar.setCookie(cookieStr, baseUrl);
                loadedCount++;
            }
            catch (cookieError) {
                logger(`Failed to set cookie ${name}:`, cookieError.message);
            }
        }
        logger(`Loaded ${loadedCount} cookies from ${this.cookieFile}`);
        return loadedCount > 0;
    }
}
exports.CookieLoader = CookieLoader;
//# sourceMappingURL=cookie-loader.js.map