const ObjectID = require('bson-objectid').default;
const urlUtils = require('../../../shared/url-utils');
const settings = require('../../../shared/settings-cache/index.js');
const errors = require('@tryghost/errors');
const tpl = require('@tryghost/tpl');

const GHOST_ADMIN_SECOND_FACTOR_MAGIC_LINK_TPL = '/signin/second-factor/magic-link/{id}/{token}';

const messages = {
    signIn: 'Sign in to {siteTitle}',
    emailSent: 'An email has been sent, please check your email.',
    factorMustBePendingToVerifyForActivation: 'This second factor is {status}, there is no need to provide verification for activation.',
    factorIsNotActive: 'Factor is not active; cannot be used to log you in',
    disablingThisFactorWillLockYouOut: 'Cannot disable the only active factor'
};

/** @type {ReturnType<typeof module.exports.createMfaService>} */
let mfaSingleton;

/** @type {import('@potluri/simple-mfa').MAGIC_LINK_SERVER_TO_SEND_EMAIL} */
// @ts-expect-error this variable is configured when simple-mfa is lazily initialized
let MAGIC_LINK_SEND_EMAIL = '';

/**
 * @param {{id: string; token: string; email: string}} data
 */
async function sendMagicLinkNotification({id, token, email}) {
    const emailApi = require('../../api/endpoints/index.js').mail;
    const mail = require('../mail');
    const confirmationUrl = new URL(urlUtils.urlFor('admin', true));
    confirmationUrl.hash = tpl(GHOST_ADMIN_SECOND_FACTOR_MAGIC_LINK_TPL, {id, token});

    const emailData = {
        confirmationUrl: confirmationUrl.href,
        recipientEmail: email
    };

    const content = await mail.utils.generateContent({
        data: emailData,
        template: 'multi-factor-magic-link'
    });

    const payload = {
        mail: [{
            message: {
                to: email,
                subject: tpl(messages.signIn, {siteTitle: settings.get('title')}),
                html: content.html,
                text: content.text
            },
            options: {}
        }]
    };

    return emailApi.send(payload, {context: {internal: true}});
}

module.exports.getMfaService = () => {
    if (!mfaSingleton) {
        mfaSingleton = module.exports.createMfaService();
    }

    return mfaSingleton;
};

module.exports.createMfaService = () => {
    const {
        createSimpleMfa, StorageService, StrategyError, MAGIC_LINK_SERVER_TO_SEND_EMAIL: emailSentConstant
    } = require('@potluri/simple-mfa');
    const {defaultStrategies} = require('@potluri/simple-mfa/default-strategies.js');
    const storageService = new StorageService(getSecrets());
    const simpleMfa = createSimpleMfa({
        generateId: () => ObjectID().toHexString(),
        strategies: defaultStrategies(storageService)
    });

    MAGIC_LINK_SEND_EMAIL = emailSentConstant;

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
     * @param {string} email
     * @param {unknown} proof
     * @param {boolean} forActivation
     */
    async function validateSecondFactor(storedStrategy, email, proof, forActivation = false) {
        const strategy = simpleMfa.coerce(storedStrategy);
        if (!forActivation && strategy.status !== 'active') {
            throw new errors.BadRequestError({message: messages.factorIsNotActive});
        }

        const prepareResult = await simpleMfa.prepare(strategy, proof);

        if (prepareResult?.type === MAGIC_LINK_SEND_EMAIL) {
            const variables = {id: strategy.id, email, token: prepareResult.data.token};
            await sendMagicLinkNotification(variables);
            return {success: true, complete: false, message: messages.emailSent};
        }

        // CASE: Strategy#prepare provided a response, but we didn't handle it. We can't assume that we can move on
        // to validation
        if (prepareResult) {
            throw new errors.InternalServerError({message: 'Unknown validation response', context: prepareResult});
        }

        if (await simpleMfa.validate(strategy, proof)) {
            const postValidated = forActivation ? undefined : await simpleMfa.postValidate(strategy, proof);
            return {postValidated, success: true, complete: true, status: forActivation ? 'activated' : 'created'};
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
        const {complete, message} = await validateSecondFactor(model.toJSON(), null, proof, true);

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
