"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core = require("./index");
const fca_compat_1 = require("./fca-compat");
const exported = fca_compat_1.default;
Object.assign(exported, core, { login: fca_compat_1.default, FcaInstagramApi: fca_compat_1.FcaInstagramApi, METHODS: fca_compat_1.METHODS });
module.exports = exported;
//# sourceMappingURL=compat.js.map