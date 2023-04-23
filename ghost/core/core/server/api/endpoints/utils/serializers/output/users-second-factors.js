const {getMfaService} = require('../../../../../services/auth/multifactor.js');
const {sessionService} = require('../../../../../services/auth/session/index.js');

module.exports = {
    async browse(models, apiImpl, frame) {
        const mfaService = getMfaService();
        const isTrusted = !sessionService.waitingForSecondFactor(frame.original.session);
        const pojoModels = models.data.map(model => model.toJSON());
        frame.response = {
            users_second_factors: await mfaService.serializeForApi(pojoModels, isTrusted),
            meta: models.meta
        };

        return frame.response;
    },

    async read(model, apiImpl, frame) {
        const mfaService = getMfaService();
        const isUntrusted = sessionService.waitingForSecondFactor(frame.original.session);
        frame.response = {
            users_second_factors: await mfaService.serializeForApi([model.toJSON()], isUntrusted)
        };

        return frame.response;
    },

    async add(model, apiImpl, frame) {
        const mfaService = getMfaService();
        frame.response = {
            // If a user can add a second factor they are considered to be a trusted actor
            users_second_factors: await mfaService.serializeForApi([model.toJSON()], true)
        };

        return frame.response;
    }
};
