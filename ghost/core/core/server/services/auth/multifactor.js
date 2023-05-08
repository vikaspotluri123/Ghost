const ObjectID = require('bson-objectid').default;
const settings = require('../../../shared/settings-cache/index.js');
const errors = require('@tryghost/errors');
const tpl = require('@tryghost/tpl');

const messages = {
    emailSent: 'An email has been sent, please check your email.',
    factorMustBePendingToVerifyForActivation: 'This second factor is {status}, there is no need to provide verification for activation.',
    disablingThisFactorWillLockYouOut: 'Cannot disable the only active factor'
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
    const {createSimpleMfa, StorageService, StrategyError} = require('@potluri/simple-mfa');
    const {defaultStrategies} = require('@potluri/simple-mfa/default-strategies.js');
    const storageService = new StorageService(getSecrets());
    const simpleMfa = createSimpleMfa({
        generateId: () => ObjectID().toHexString(),
        sendEmail: (context, variables) => {
            // @TODO: wire up with email service
            console.log(`send email ${context} with variables ${JSON.stringify(variables)})`);
        },
        strategies: defaultStrategies(storageService)
    });

    /**
     * @param {any} jsonModel
     * @param {Parameters<typeof simpleMfa['assertStatusTransition']>[1]} nextStatus
     */
    function assertStatusTransition(jsonModel, nextStatus) {
        try {
            return simpleMfa.assertStatusTransition(jsonModel, nextStatus);
        } catch (err) {
            if (isPublicError(err)) {
                throw new errors.BadRequestError({message: err.message, err});
            }

            throw new errors.InternalServerError({err});
        }
    }

    function getSecrets() {
        return settings.get('second_factor_secrets') ?? {};
    }

    /**
     * @param {Parameters<typeof simpleMfa['serialize']>[0][]} strategies
     * @param {boolean} isTrusted
     */
    function serializeForApi(strategies, isTrusted) {
        return Promise.all(strategies.map(strategy => simpleMfa.serialize(strategy, isTrusted)));
    }

    /**
     * @param {unknown} proof
     * @param {boolean} forActivation
     */
    async function validateSecondFactor(storedStrategy, proof, forActivation = false) {
        const strategy = simpleMfa.coerce(storedStrategy);
        if (!forActivation && strategy.status !== 'active') {
            throw new errors.BadRequestError({message: messages.factorIsNotActive});
        }

        const prepareResult = await simpleMfa.prepare(strategy);

        if (prepareResult === 'email_sent') {
            return {success: true, complete: false, message: messages.emailSent};
        }

        // CASE: Strategy#prepare provided a response, but we didn't handle it. We can't assume that we can move on
        // to validation
        if (prepareResult) {
            throw new errors.InternalServerError({message: 'Unknown validation response', context: prepareResult});
        }

        if (await simpleMfa.validate(strategy, proof)) {
            return {success: true, complete: true, status: forActivation ? 'activated' : 'created'};
        }

        const InvalidSecretError = forActivation ? errors.BadRequestError : errors.UnauthorizedError;
        throw new InvalidSecretError({message: 'Factor secret is invalid'});
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

    /**
     * @param {import('bookshelf').Model & {wasChanged: () => boolean}} model
     * @param {unknown} proof
     * @returns {Promise<boolean>} if a change was made
     */
    async function activatePendingFactor(model, proof) {
        const storedStrategy = simpleMfa.coerce(model.toJSON());

        if (storedStrategy.status !== 'pending') {
            const message = tpl(messages.factorMustBePendingToVerifyForActivation, {status: storedStrategy.status});
            throw new errors.BadRequestError({message});
        }

        assertStatusTransition(storedStrategy, 'active');
        const {complete, message} = await validateSecondFactor(model.toJSON(), proof, true);

        if (complete) {
            await model.save({status: 'active'});
            return model.wasChanged();
        }

        throw new errors.InternalServerError({
            message: 'Unexpected state: validation did not error or confirm completion',
            context: message
        });
    }

    /**
     * @param {import('bookshelf').Model & {
     *  get(attr: 'mfa_enabled'): boolean;
     *  second_factors(): import('bookshelf').Model;
     * }} user
     * @param {string} newStatus
     */
    async function ensureStatusChangeWillNotCauseLockOut(user, newStatus) {
        if (!(user.get('mfa_enabled') && newStatus !== 'active')) {
            return;
        }

        const activeFactorCount = await user.second_factors()
            .where({status: 'active'})
            .count('id');

        if (activeFactorCount <= 1) {
            throw new errors.BadRequestError({message: messages.disablingThisFactorWillLockYouOut});
        }
    }

    return {
        serializeForApi,
        defaults: simpleMfa.create,
        share: simpleMfa.share,
        assertStatusTransition,
        validateSecondFactor,
        syncSecrets,
        isPublicError,
        activatePendingFactor,
        ensureStatusChangeWillNotCauseLockOut
    };
};
