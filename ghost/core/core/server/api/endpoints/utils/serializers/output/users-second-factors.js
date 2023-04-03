const {getMfaService} = require('../../../../../services/auth/multifactor.js');

module.exports = {
    browse(model, apiImpl, frame) {
        const mfaService = getMfaService();
        frame.response = {
            users_second_factors: mfaService.serializeForApi(model.data, true),
            meta: model.meta
        };

        return frame.response;
    },

    read(model, apiImpl, frame) {
        const mfaService = getMfaService();
        frame.response = {
            users_second_factors: mfaService.serializeForApi([model], true)
        };

        return frame.response;
    },

    async add(model, apiImpl, frame) {
        const mfaService = getMfaService();
        const jsonModel = model.toJSON();
        const context = await mfaService.share(jsonModel);
        frame.response = {
            users_second_factors: mfaService.serializeForApi([jsonModel])
        };

        frame.response.users_second_factors[0].context = context;

        return frame.response;
    }
};
