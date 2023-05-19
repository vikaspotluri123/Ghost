const ObjectID = require('bson-objectid').default;
const urlUtils = require('../../../shared/url-utils');
const settings = require('../../../shared/settings-cache/index.js');
const errors = require('@tryghost/errors');
const tpl = require('@tryghost/tpl');

const GHOST_ADMIN_SECOND_FACTOR_MAGIC_LINK_TPL = '/signin/second-factor/magic-link/{id}/{token}';

const messages = {
    signIn: 'Sign in to {siteTitle}',
    emailSent: 'An email has been sent, please check your email.',
    disablingThisFactorWillLockYouOut: 'Cannot disable the only active factor',
    invalidSecret: 'Factor secret is invalid'
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
        createSimpleMfa, SimpleMfaNodeCrypto, StrategyError, MAGIC_LINK_SERVER_TO_SEND_EMAIL: emailSentConstant
    } = require('@potluri/simple-mfa');
    const {defaultStrategies} = require('@potluri/simple-mfa/default-strategies.js');
    const simpleMfaCrypto = new SimpleMfaNodeCrypto(getSecrets());
    const simpleMfa = createSimpleMfa({
        generateId: () => ObjectID().toHexString(),
        strategies: defaultStrategies(simpleMfaCrypto)
    });

    MAGIC_LINK_SEND_EMAIL = emailSentConstant;

    /**
     * @typedef {typeof simpleMfa} Mfa
     * @description Calls a simpleMfa method and converts errors thrown by the library to a Ghost-compatible format
     * @type {<TMethod extends keyof Mfa>(method: TMethod, ...args: Parameters<Mfa[TMethod]>) => ReturnType<Mfa[TMethod]>}
     */
    const wrapSimpleMfa = (method, ...args) => {
        try {
            // @ts-expect-error TODO: this is functionally correct and provides correct type inference elsewhere
            return simpleMfa[method](...args);
        } catch (err) {
            if (isPublicError(err)) {
                throw new errors.BadRequestError({message: err.message, err});
            }

            throw new errors.InternalServerError({err});
        }
    };

    function getSecrets() {
        return settings.get('second_factor_secrets') ?? {};
    }

    /**0
     * @param {Parameters<Mfa['serialize']>[0][]} strategies
     * @param {boolean} isTrusted
     */
    function serializeForApi(strategies, isTrusted) {
        return Promise.all(strategies.map(strategy => simpleMfa.serialize(strategy, isTrusted)));
    }

    /**
     * @param {string} email
     * @param {unknown} proof
     */
    async function validateSecondFactor(storedStrategy, email, proof) {
        const strategy = wrapSimpleMfa('coerce', storedStrategy);
        const {type, response} = await wrapSimpleMfa('validate', strategy, proof);

        if (type === 'validationSucceeded') {
            return {
                success: true,
                completed: true,
                status: 'created',
                postValidated: response
            };
        }

        if (type === 'validationFailed') {
            const InvalidSecretError = errors.UnauthorizedError;
            throw new InvalidSecretError({message: messages.invalidSecret});
        }

        if (type === 'serverActionRequired') {
            if (response.action === MAGIC_LINK_SEND_EMAIL) {
                const variables = {id: strategy.id, email, token: response.data.token};
                await sendMagicLinkNotification(variables);
                return {success: true, complete: false, message: messages.emailSent};
            }

            throw new errors.InternalServerError({
                message: 'Unknown action required', context: response.action ?? String(response)
            });
        }

        throw new errors.InternalServerError({message: 'Unknown validation response', context: type});
    }

    function syncSecrets() {
        const currentSecret = getSecrets();
        simpleMfa.syncSecrets(simpleMfaCrypto, currentSecret);
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
        const storedStrategy = wrapSimpleMfa('coerce', model.toJSON());
        const activated = await wrapSimpleMfa('activate', storedStrategy, proof);

        if (activated) {
            wrapSimpleMfa('assertStatusTransition', storedStrategy, 'active');
            await model.save({status: 'active'});
            return model.wasChanged();
        }

        throw new errors.BadRequestError({message: messages.invalidSecret});
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

    /**
     * @param {Parameters<Mfa['create']>} args
     */
    async function defaults(...args) {
        try {
            return simpleMfa.create(...args);
        } catch (err) {
            if (isPublicError(err)) {
                throw new errors.ValidationError({message: err.message, err});
            }

            throw err;
        }
    }

    return {
        serializeForApi,
        defaults,
        /** @type {Mfa['assertStatusTransition']} */
        assertStatusTransition: (...args) => wrapSimpleMfa('assertStatusTransition', ...args),
        validateSecondFactor,
        syncSecrets,
        activatePendingFactor,
        ensureStatusChangeWillNotCauseLockOut
    };
};
