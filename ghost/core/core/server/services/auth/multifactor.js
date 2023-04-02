const ObjectID = require('bson-objectid').default;
const {createSimpleMFA, StorageService, defaultStrategies, StrategyError} = require('@potluri/simple-mfa');
const settings = require('../../../shared/settings-cache/index.js');
const errors = require('@tryghost/errors');

const messages = {
    emailSent: 'An email has been sent, please check your email.'
};

/** @type {ReturnType<typeof module.exports.createMfaService>} */
let mfaSingleton;

module.exports.getMfaService = () => {
    if (!mfaSingleton) {
        mfaSingleton = module.exports.createMfaService();
    }

    return mfaSingleton;
};

module.exports.createMfaService = () => {
    const storageService = new StorageService(getSecrets());
    const simpleMfa = createSimpleMFA({
        generateId: () => ObjectID().toHexString(),
        sendEmail: (context, variables) => {
            // @TODO: wire up with email service
            console.log(`send email ${context} with variables ${JSON.stringify(variables)})`);
        },
        strategies: defaultStrategies(storageService)
    });

    function getSecrets() {
        return settings.get('second_factor_secrets') ?? {};
    }

    /**
     * @param {Parameters<typeof simpleMfa['serialize']>[0][] | import('bookshelf').Model[]} strategies
     * @param {boolean} isModel
     */
    function serializeForApi(strategies, isModel = false) {
        return strategies.map(strategy => simpleMfa.serialize(isModel ? strategy.toJSON() : strategy));
    }

    /**
     * @param {unknown} proof
     */
    async function validateSecondFactor(storedStrategy, proof) {
        const strategy = simpleMfa.coerce(storedStrategy);
        const prepareResult = await simpleMfa.prepare(strategy);

        if (prepareResult === 'email_sent') {
            return {success: true, complete: false, message: messages.emailSent};
        }

        if (!prepareResult) {
            throw new errors.InternalServerError({message: 'Unknown validation response', context: prepareResult});
        }

        if (await simpleMfa.validate(strategy, proof)) {
            return {success: true, complete: true, status: 'created'};
        }

        throw new errors.UnauthorizedError({message: 'Factor secret is invalid'});
    }

    function syncSecrets() {
        const currentSecret = getSecrets();
        simpleMfa.syncSecrets(storageService, currentSecret);
        return JSON.stringify(currentSecret);
    }

    /**
     * @param {unknown} error
     * @returns {error is StrategyError}
     */
    function isPublicError(error) {
        return error instanceof StrategyError && error.isUserFacing;
    }

    return {
        serializeForApi,
        defaults: simpleMfa.create,
        share: simpleMfa.share,
        validateSecondFactor,
        syncSecrets,
        isPublicError
    };
};
