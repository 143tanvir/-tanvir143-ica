const fs = require('fs');
const path = require('path');

const root = __dirname;
const dist = path.join(root, 'dist');
const compatSource = fs.readFileSync(path.join(root, 'src', 'fca-compat.ts'), 'utf8');
const accountSource = fs.readFileSync(path.join(root, 'src', 'repositories', 'account.repository.ts'), 'utf8');
const compatJs = fs.readFileSync(path.join(dist, 'fca-compat.js'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const required = [
  'getUserInfo', 'getThreadInfo', 'getThreadList', 'getThreadHistory',
  'sendMessage', 'sendImage', 'sendAudio', 'sendVideo',
  'sendTextEffect', 'sendAvatarTextEffect', 'sendMusic', 'musicSearch',
  'sendTypingIndicator', 'stopTypingIndicator', 'setMessageReaction', 'unsendMessage', 'deleteMessage',
  'markAsRead', 'markAsDelivered', 'setTitle', 'addUserToThread', 'removeUserFromThread',
  'changeThreadMute', 'changeBio', 'changeProfilePicture', 'changeAvatar',
  'getAppState', 'setOptions', 'logout'
];
const helpers = ['getCurrentUserID', 'listenMqtt', 'listen', 'setBiography'];
const advanced = ['removeMessageReaction', 'createGroupThread', 'getPresence', 'hideThread', 'leaveThread'];

if (packageJson.name !== 'insta-robot') throw new Error('Package name is not insta-robot');
if (packageJson.version !== '1.0.4') throw new Error('Package version is not 1.0.4');
if (packageJson.main !== 'dist/compat.js') throw new Error('Unexpected package main');

for (const file of [path.join(dist, 'compat.js'), path.join(dist, 'fca-compat.js'), path.join(dist, 'index.js')]) {
  if (!fs.existsSync(file)) throw new Error(`Missing emitted file: ${file}`);
}

for (const name of [...required, ...helpers, ...advanced]) {
  if (!compatSource.includes(name) || !compatJs.includes(name)) {
    throw new Error(`Missing compatibility method: ${name}`);
  }
}

const part01 = fs.readdirSync(path.join(root, 'src', 'responses', '01')).filter(f => f.endsWith('.ts'));
const part02 = fs.readdirSync(path.join(root, 'src', 'responses', '02')).filter(f => f.endsWith('.ts'));
if (part01.length > 99 || part02.length > 99) throw new Error('A response folder exceeds the 99-file GitHub upload target.');
if (!fs.existsSync(path.join(root, 'src', 'responses', 'index.ts'))) throw new Error('Missing response barrel index.');

if (/url:\s*['"]\/api\/v1\/accounts\/current_user\//.test(accountSource) && /edit:\s*true/.test(accountSource)) {
  throw new Error('Legacy current_user edit=true request is still present.');
}
if (!compatSource.includes('validateWebSession')) throw new Error('Web-session login fallback is missing.');
if (!compatSource.includes('IgCheckpointError') || !compatSource.includes('IgLoginRequiredError')) {
  throw new Error('Explicit authentication error handling is missing.');
}
if (!compatSource.includes('DEFAULT_LOGIN_USER_AGENT')) throw new Error('Reference login User-Agent is missing.');

console.log(`ICA smoke test: PASS (${required.length} core + ${helpers.length} helper + ${advanced.length} advanced; responses split ${part01.length}/${part02.length})`);
console.log('Login validation test: PASS (plain current_user + web fallback + explicit auth errors)');
