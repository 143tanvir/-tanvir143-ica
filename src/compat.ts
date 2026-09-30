import * as core from './index';
import loginCompat, { FcaInstagramApi, METHODS } from './fca-compat';

// A callable CommonJS export for `const login = require('@tanvir143/ica')`.
// The core SDK exports are copied onto the function so both styles remain available.
const exported: any = loginCompat;
Object.assign(exported, core, { login: loginCompat, FcaInstagramApi, METHODS });
module.exports = exported;
