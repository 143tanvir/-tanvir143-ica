"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DirectThreadInfoRepository = void 0;
const repository_1 = require("../core/repository");
class DirectThreadInfoRepository extends repository_1.Repository {
    async getThreadInfo(threadId) {
        const { body } = await this.client.request.send({
            url: '/api/graphql',
            method: 'POST',
            form: {
                av: '17841477311673826',
                __d: 'www',
                __user: '0',
                __a: '1',
                __req: '1',
                __hs: '20369.HYP:instagram_web_pkg.2.1...0',
                dpr: '1',
                __ccg: 'GOOD',
                __rev: '1028120506',
                __s: '',
                __hsi: '7558650547389888447',
                __comet_req: '7',
                lsd: 'O0IugSqhs3vM95mTit28Ts',
                __spin_r: '1028120506',
                __spin_b: 'trunk',
                __spin_t: Date.now().toString(),
                fb_api_caller_class: 'RelayModern',
                fb_api_req_friendly_name: 'IGDThreadDetailMainViewOffMsysQuery',
                server_timestamps: 'true',
                variables: JSON.stringify({
                    thread_fbid: threadId,
                    min_uq_seq_id: 100,
                    pass_composer_gk: false,
                    pass_message_list_gk: false,
                    pass_project_cannes_gk: true,
                }),
                doc_id: '25051850821067617',
            },
        });
        return body;
    }
    async getThreadMessages(threadId, minSeqId = 115) {
        const { body } = await this.client.request.send({
            url: '/api/graphql',
            method: 'POST',
            form: {
                av: '17841477311673826',
                __d: 'www',
                __user: '0',
                __a: '1',
                __req: '1',
                __comet_req: '7',
                lsd: 'O0IugSqhs3vM95mTit28Ts',
                fb_api_caller_class: 'RelayModern',
                fb_api_req_friendly_name: 'IGDSlideAsyncFetchAndInsertIGDViewerThreadQuery',
                server_timestamps: 'true',
                variables: JSON.stringify({
                    thread_fbid: threadId,
                    min_uq_seq_id: minSeqId,
                    __relay_internal__pv__IGDMaxUnreadMessagesCountrelayprovider: 5,
                }),
                doc_id: '23974600915546870',
            },
        });
        return body;
    }
}
exports.DirectThreadInfoRepository = DirectThreadInfoRepository;
//# sourceMappingURL=direct-thread-info.repository.js.map