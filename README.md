# insta-robot

### Local Instagram Private API Client • FCA-Compatible InstaBot Adapter • Cookie/AppState Authentication • MQTT Realtime

> **Unofficial / Private API**
>
> `insta-robot` is an unofficial Instagram private-API client and FCA-compatible adapter. It uses Instagram private/web endpoints that may change without notice.
>
> Use this package only with accounts and sessions you are authorized to use. Always comply with Instagram's Terms of Use and applicable laws.

---

## 🚀 Overview

**`insta-robot`** is a local Instagram private API client and FCA-compatible ICA adapter designed for InstaBot-style applications.

It provides a local authentication and communication layer between an InstaBot application and Instagram without requiring a remote ICA/RPC server.

### Core capabilities

- 🍪 Cookie / AppState authentication
- 🔐 Local session management
- 🌐 Browser-style User-Agent
- ✅ Session validation
- 📡 MQTT realtime messaging
- 💬 FCA-compatible messaging API
- 👥 Thread and group management
- 🎵 Music-related methods
- 👤 User and account methods
- 📨 Message reactions
- ⌨️ Typing indicators
- 🖼️ Media sending
- 🏠 Fully local ICA architecture
- 🚫 No remote ICA/RPC server required

---

## 🏗️ Architecture

```text
┌──────────────────────────────┐
│           InstaBot           │
│       FCA-Compatible Bot     │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│         insta-robot          │
│          Local ICA           │
├──────────────────────────────┤
│ Cookie / AppState Auth       │
│ Session Validation            │
│ Instagram API Client         │
│ FCA Compatibility Layer      │
│ MQTT Realtime Transport      │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│          Instagram           │
│ Private / Web Endpoints      │
│ MQTT Realtime Messaging      │
└──────────────────────────────┘
```

### Local execution

Traditional architecture:

```text
InstaBot → Remote ICA → Instagram
```

`insta-robot` architecture:

```text
InstaBot → insta-robot → Instagram
```

The ICA runs directly inside the bot process.

No external:

```text
Remote ICA
RPC server
/rpc endpoint
ICA hosting service
```

is required.

---

# 📦 Installation

Install from npm:

```bash
npm install insta-robot
```

Or:

```bash
yarn add insta-robot
```

Or:

```bash
pnpm add insta-robot
```

---

# 🧰 Requirements

Recommended environment:

- Node.js 18+
- npm 9+
- A valid Instagram account/session
- A supported authentication method

Node.js 18+ is recommended for production deployments.

---

# 🔑 Authentication

`insta-robot` supports multiple authentication formats.

Supported inputs include:

- AppState arrays
- Cookie arrays
- Cookie header strings
- JSON cookie strings
- Netscape cookie text
- Cookie files
- `{ appState: [...] }`
- `{ cookies: [...] }`
- `{ cookieFile: './account.json' }`
- Username/password where supported by the underlying client

---

# 🍪 AppState Authentication

Example:

```js
const login = require('insta-robot');

login({
  appState: [
    {
      key: 'sessionid',
      value: 'YOUR_SESSION_ID',
      domain: '.instagram.com',
      path: '/',
      secure: true
    },
    {
      key: 'ds_user_id',
      value: 'YOUR_USER_ID',
      domain: '.instagram.com',
      path: '/',
      secure: true
    }
  ]
}, (err, api) => {
  if (err) {
    console.error('Login failed:', err);
    return;
  }

  console.log('Logged in:', api.getCurrentUserID());
});
```

---

# 🍪 Cookie Array

```js
const login = require('insta-robot');

login({
  cookies: [
    {
      key: 'sessionid',
      value: 'YOUR_SESSION_ID'
    },
    {
      key: 'ds_user_id',
      value: 'YOUR_USER_ID'
    }
  ]
}, callback);
```

---

# 🧾 Cookie Header

```js
const login = require('insta-robot');

login({
  cookies:
    'sessionid=YOUR_SESSION; ds_user_id=YOUR_USER_ID; csrftoken=YOUR_CSRF'
}, callback);
```

---

# 📄 Cookie File

```js
const login = require('insta-robot');

login({
  cookieFile: './account.json'
}, callback);
```

Keep authentication files private and outside public repositories.

---

# ⚡ Basic Usage

## Callback API

```js
const login = require('insta-robot');

login({ appState }, (err, api) => {
  if (err) {
    console.error('Instagram login failed:', err);
    return;
  }

  console.log('Logged in user ID:', api.getCurrentUserID());

  api.listenMqtt((err, event) => {
    if (err) {
      console.error('MQTT error:', err);
      return;
    }

    console.log('Instagram event:', event);
  });
});
```

---

# ⚡ Promise API

```js
const login = require('insta-robot');

async function start() {
  try {
    const api = await login({ appState });

    console.log('Logged in user ID:', api.getCurrentUserID());

    api.listenMqtt((err, event) => {
      if (err) {
        console.error('MQTT error:', err);
        return;
      }

      console.log('Instagram event:', event);
    });
  } catch (error) {
    console.error('Login failed:', error);
  }
}

start();
```

---

# 🔄 Authentication Flow

The authentication process follows a local cookie-jar based validation flow.

```text
Cookie / AppState
       │
       ▼
Import cookies into local cookie jar
       │
       ▼
Apply browser-style User-Agent
       │
       ▼
Primary Instagram session validation
       │
       ├──────── Valid ──────────► Continue
       │
       └──────── Error
                  │
                  ▼
        Instagram web-session check
                  │
             ┌────┴────┐
             ▼         ▼
           Valid      Error
             │         │
             ▼         ▼
          Continue   Return error
```

---

# 🌐 Session Validation

The primary validation endpoint is:

```text
/api/v1/accounts/current_user/
```

The legacy request:

```text
/api/v1/accounts/current_user/?edit=true
```

is intentionally not generated by the current compatibility login path.

If the primary endpoint returns an application-level error, `insta-robot` can perform a normal Instagram web-session validation using the same cookie jar and browser-style User-Agent.

This allows the authentication layer to distinguish between:

- Valid sessions
- Expired sessions
- Logged-out sessions
- Login-required responses
- Checkpoints
- Authentication failures
- Unexpected application responses

---

# 🛡️ Security & Verification

`insta-robot` does **not** bypass Instagram security systems.

It does not bypass:

- Two-factor authentication
- Checkpoints
- Login challenges
- Security verification
- Account restrictions
- Session invalidation

If Instagram requires additional verification, the account/session must complete Instagram's required verification process.

A previously valid session can become invalid at any time.

---

# 🤖 InstaBot Compatibility

`insta-robot` provides an FCA-style compatibility API for InstaBot/ICA integrations.

## 👤 User Methods

```text
getUserInfo
getCurrentUserID
getPresence
```

## 💬 Thread Methods

```text
getThreadInfo
getThreadList
getThreadHistory
createGroupThread
addUserToThread
removeUserFromThread
setTitle
changeThreadMute
hideThread
leaveThread
```

## 📨 Message Methods

```text
sendMessage
sendImage
sendAudio
sendVideo
sendMusic
sendTextEffect
sendAvatarTextEffect
unsendMessage
deleteMessage
setMessageReaction
removeMessageReaction
markAsRead
markAsDelivered
```

## ⌨️ Typing Methods

```text
sendTypingIndicator
stopTypingIndicator
```

## 👤 Account Methods

```text
changeBio
setBiography
changeProfilePicture
changeAvatar
getAppState
logout
```

## 📡 Realtime Methods

```text
listenMqtt
listen
```

## 🎵 Music Methods

```text
musicSearch
sendMusic
```

## ⚙️ Configuration

```text
setOptions
```

> The exact behavior of individual methods depends on the current Instagram private API and the underlying implementation.

---

# 🔌 Using with InstaBot

Install the ICA:

```bash
npm install insta-robot
```

Then load it inside your bot:

```js
const login = require('insta-robot');
```

Example:

```js
login({ appState }, (err, api) => {
  if (err) {
    return console.error(err);
  }

  console.log('Instagram account:', api.getCurrentUserID());

  api.listenMqtt((err, event) => {
    if (err) {
      return console.error(err);
    }

    console.log(event);
  });
});
```

The package operates locally inside the bot process.

```text
InstaBot
   │
   └── insta-robot
          │
          ├── Authentication
          ├── Instagram API
          └── MQTT
```

---

# 📡 MQTT Realtime

`insta-robot` supports MQTT-based realtime communication.

Example:

```js
api.listenMqtt((err, event) => {
  if (err) {
    console.error('MQTT error:', err);
    return;
  }

  console.log('New Instagram event:', event);
});
```

Realtime behavior depends on Instagram's current MQTT/private API implementation.

---

# 🧑‍💻 Development

Clone the repository:

```bash
git clone https://github.com/143tanvir/ica-tanvir143.git
```

Enter the project:

```bash
cd ica-tanvir143
```

Install dependencies:

```bash
npm install
```

Run type checking:

```bash
npm run typecheck
```

Build:

```bash
npm run build
```

Run tests:

```bash
npm test
```

---

# 📁 Project Structure

Typical project structure:

```text
insta-robot/
│
├── src/
│   ├── ...
│   └── compat.js
│
├── dist/
│   ├── index.js
│   ├── compat.js
│   └── ...
│
├── examples/
│
├── tests/
│
├── README.md
├── LICENSE
├── package.json
└── ...
```

The exact source and generated files may change between releases.

---

# 🧪 Testing

Automated checks may cover:

- Package metadata
- Package name
- Distribution files
- Compatibility API surface
- JavaScript syntax
- TypeScript syntax/type checking
- Cookie parsing
- Authentication source checks
- Response-folder organization
- Package structure
- Legacy `current_user/?edit=true` detection

A live Instagram login should not be performed in CI because it would require real authentication credentials or session cookies.

---

# 🚂 Railway / Production Deployment

`insta-robot` can be used in Node.js hosting environments such as Railway.

Recommended deployment flow:

```text
Railway
   │
   ▼
Node.js Application
   │
   ▼
InstaBot
   │
   ▼
insta-robot
   │
   ▼
Instagram
```

For production:

1. Install `insta-robot`.
2. Configure required environment variables.
3. Never commit session cookies.
4. Use a supported Node.js version.
5. Monitor authentication errors.
6. Replace expired sessions when necessary.

Example:

```bash
npm install insta-robot
npm start
```

---

# 🔐 Environment Variables

Sensitive values should be stored using your hosting provider's environment-variable system.

Example:

```env
INSTAGRAM_SESSION_ID=your_session_id
INSTAGRAM_USER_ID=your_user_id
INSTAGRAM_CSRF_TOKEN=your_csrftoken
```

Never publish real values.

---

# 🔒 Security

Instagram session cookies are authentication credentials.

Treat the following as sensitive:

```text
sessionid
csrftoken
ds_user_id
mid
ig_did
AppState
passwords
authentication tokens
private API credentials
```

Never commit:

```text
.env
AppState.json
appstate.json
cookies.json
account.json
account.txt
*.session
```

Recommended `.gitignore`:

```gitignore
.env
AppState.json
appstate.json
cookies.json
account.json
account.txt
*.session
```

### If credentials are exposed

Immediately invalidate/revoke the affected session through the appropriate Instagram account security controls and create a new session.

---

# ⚠️ Error Handling

Always handle login errors:

```js
login({ appState }, (err, api) => {
  if (err) {
    console.error('Login failed:', err);
    return;
  }

  console.log('Login successful');
});
```

Common error categories:

| Error | Meaning |
|---|---|
| `login_required` | Instagram requires authentication |
| `user_has_logged_out` | The supplied session is logged out |
| Checkpoint | Instagram requires security verification |
| Invalid session | Cookies/session are no longer valid |
| Network error | Instagram could not be reached |
| Application error | Instagram returned an unexpected response |

Exact error messages can vary because Instagram's private API is not a stable public API.

---

# 🔄 API Stability

Instagram's private endpoints are not guaranteed to remain stable.

Instagram may change:

- Endpoint paths
- Request parameters
- Response structures
- Authentication requirements
- Cookies
- Headers
- MQTT behavior
- Session validation
- Security requirements

Therefore, an Instagram-side change may require a new `insta-robot` release.

This project should not be considered an official Instagram SDK.

---

# 📌 Compatibility Philosophy

The goal of `insta-robot` is to provide an ICA layer that can be used by existing InstaBot applications with minimal changes.

### Remote ICA

```text
Bot
 │
 ▼
Remote ICA
 │
 ▼
RPC
 │
 ▼
Instagram
```

### Local ICA

```text
Bot
 │
 ▼
insta-robot
 │
 ├── Authentication
 ├── API
 └── MQTT
 │
 ▼
Instagram
```

The local architecture removes the requirement for a separate ICA server.

---

# 📦 Package Information

| Property | Value |
|---|---|
| Package | `insta-robot` |
| Type | Local Instagram Private API Client |
| Compatibility | FCA / InstaBot |
| Authentication | Cookie / AppState |
| Realtime | MQTT |
| Runtime | Node.js |
| Remote ICA | Not required |
| License | MIT |

---

# 🛠️ Contributing

Contributions are welcome.

Before submitting changes:

1. Keep changes focused.
2. Do not include real credentials.
3. Never commit AppState or cookie files.
4. Run tests before submitting.
5. Verify the build.
6. Document compatibility-impacting changes.
7. Never expose private authentication data in logs or issues.

---

# 📜 License

MIT License.

See `LICENSE` for the complete license text.

---

# 👨‍💻 Author

**Tanvir Ahmed**

GitHub:

https://github.com/143tanvir

---

# ⚠️ Disclaimer

`insta-robot` is an independent and unofficial project.

It is **not affiliated with, endorsed by, sponsored by, or officially supported by Instagram or Meta Platforms, Inc.**

Instagram is a trademark of Meta Platforms, Inc.

Use this software responsibly and only with accounts and sessions you are authorized to access.
