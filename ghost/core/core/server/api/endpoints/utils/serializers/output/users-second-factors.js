const {getMfaService} = require('../../../../../services/auth/multifactor.js');
const {sessionService} = require('../../../../../services/auth/session/index.js');

async function genericSerializer(model, apiImpl, frame) {
    const mfaService = getMfaService();
    const isTrusted = !sessionService.waitingForSecondFactor(frame.original.session);
    const pojoModels = 'data' in model ? model.data.map(singleModel => singleModel.toJSON()) : [model.toJSON()];

    frame.response = {
        users_second_factors: await mfaService.serializeForApi(pojoModels, isTrusted)
    };

    if ('data' in model) {
        frame.response.meta = model.meta;
    }

    return frame.response;
}

async function trustedSerializer(model, apiImpl, frame) {
    const mfaService = getMfaService();
    frame.response = {
        users_second_factors: await mfaService.serializeForApi([model.toJSON()], true)
    };

    return frame.response;
}

module.exports = {
    browse: genericSerializer,
    read: genericSerializer,
    edit: genericSerializer,
    add: trustedSerializer, // If a user can add a second factor they are considered to be a trusted actor
    activatePending: trustedSerializer // If a user can activate a second factor they are considered to be a trusted actor
};
