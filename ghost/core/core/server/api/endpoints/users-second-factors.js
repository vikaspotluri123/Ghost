const Promise = require('bluebird');
const tpl = require('@tryghost/tpl');
const errors = require('@tryghost/errors');
const models = require('../../models');
const {sessionService} = require('../../services/auth/session/index.js');
const {getMfaService} = require('../../services/auth/multifactor.js');

const MAX_FACTORS_PER_USER = 15;

const messages = {
    noPermissionToAction: 'You do not have permission to perform this action',
    secondFactorNotRequired: 'You do not need to validate a second factor at this time',
    factorCountReached: 'You cannot add any more factors',
    minimumCountRequired: 'Cannot delete this second factor - you would not have enough',
    validationRequiresFactorAndProof: 'Missing factor_id or proof',
    factorIsNotActive: 'Factor is not active; cannot be used to log you in',
    mustBeArrayWithOneElement: 'Factor must be an array with 1 element'
};

function permissionOnlySelf(frame) {
    const targetId = getTargetId(frame);
    const userId = frame.user.id;
    if (targetId !== userId) {
        return Promise.reject(new errors.NoPermissionError({message: tpl(messages.noPermissionToAction)}));
    }
    return Promise.resolve();
}

function getTargetId(frame) {
    return frame.options.user === 'me' ? frame.user.id : frame.options.user;
}

module.exports = {
    docName: 'users_second_factors',

    browse: {
        options: [
            'user',
            'limit',
            'page',
            'debug'
        ],
        validations: {
            options: {
                user: {required: true}
            }
        },
        permissions: permissionOnlySelf,
        query(frame) {
            return models.UsersSecondFactor.findPage({...frame.options, user_id: frame.user.id});
        }
    },

    read: {
        options: ['user', 'id'],
        validations: {
            options: {
                user: {required: true},
                id: {required: true}
            }
        },
        permissions: permissionOnlySelf,
        query(frame) {
            return models.UsersSecondFactor.findOne({...frame.options, user_id: frame.user.id}, {require: true});
        }
    },

    edit: {
        headers: {},
        options: ['user', 'id'],
        validation(frame) {
            // @TODO: move to @tryghost/admin-api-schema
            if (!Array.isArray(frame.data.users_second_factors) || frame.data.users_second_factors.length !== 1) {
                throw new errors.ValidationError({message: messages.mustBeArrayWithOneElement});
            }

            const payload = frame.data.users_second_factors[0];
            for (const [key, value] of Object.entries(payload)) {
                if (key === 'description' || key === 'name' || key === 'status') {
                    if (typeof value !== 'string') {
                        throw new errors.ValidationError({message: `${key} must be a string`});
                    }

                    continue;
                }

                throw new errors.ValidationError({message: `Unknown property: .${key}`});
            }
        },
        permissions: permissionOnlySelf,
        async query(frame) {
            const model = await models.UsersSecondFactor.findOne({...frame.options, user_id: frame.user.id}, {require: true});
            const changes = frame.data.users_second_factors[0];
            if (Object.hasOwnProperty.call(changes, 'status')) {
                const mfaService = getMfaService();
                mfaService.assertStatusTransition(model.toJSON(), changes.status);
                await mfaService.ensureStatusChangeWillNotCauseLockOut(frame.user, changes.status);
            }

            await model.save(changes);
            this.headers.cacheInvalidate = model.wasChanged();
            return model;
        }
    },

    add: {
        options: ['user'],
        data: ['type'],
        validation(frame) {
            // @TODO: move to @tryghost/admin-api-schema
            if (!Array.isArray(frame.data.users_second_factors) || frame.data.users_second_factors.length !== 1) {
                throw new errors.ValidationError({message: messages.mustBeArrayWithOneElement});
            }

            const payload = frame.data.users_second_factors[0];
            for (const [key, value] of Object.entries(payload)) {
                if (key === 'type' || key === 'name') {
                    if (typeof value !== 'string') {
                        throw new errors.ValidationError({message: `${key} must be a string`});
                    }

                    continue;
                }

                throw new errors.ValidationError({message: `Unknown property: .${key}`});
            }
        },
        permissions: permissionOnlySelf,
        async query(frame) {
            const count = await models.UsersSecondFactor.count({user_id: frame.user.id});

            if (count >= MAX_FACTORS_PER_USER) {
                throw new errors.NoPermissionError({message: messages.factorCountReached});
            }

            const {type, name} = frame.data.users_second_factors[0];
            const model = await models.UsersSecondFactor.add(
                Object.assign(await models.UsersSecondFactor.create(type, frame.user.id), {name})
            );

            return model;
        }
    },

    destroy: {
        statusCode: 204,
        headers: {
            cacheInvalidate: true
        },
        options: [
            'user',
            'id'
        ],
        validation: {
            options: {
                user: {required: true},
                id: {required: true}
            }
        },
        permissions: permissionOnlySelf,
        async query(frame) {
            const count = await models.UsersSecondFactor.count({user_id: frame.user.id});
            if (count <= 1) {
                throw new errors.BadRequestError({message: messages.minimumCountRequired});
            }

            return models.UsersSecondFactor.destroy({user_id: frame.user.id, id: frame.options.id, require: true});
        }
    },

    validate: {
        statusCode(result) {
            return result.complete ? 201 : 200;
        },
        data: ['factor_id', 'proof'],
        validation: {
            data: {
                factor_id: {required: true, type: 'string'},
                proof: {required: true, type: 'string'}
            }
        },
        permissions(frame) {
            if (!sessionService.waitingForSecondFactor(frame.original.session)) {
                throw new errors.BadRequestError({message: messages.secondFactorNotRequired});
            }
        },
        /** @param {import('@tryghost/api-framework').Frame} frame */
        async query(frame) {
            const storedStrategy = (await models.UsersSecondFactor.findOne(
                {id: frame.data.factor_id, user_id: frame.user.id},
                {require: true}
            )).toJSON();


            const response = await getMfaService().validateSecondFactor(storedStrategy, frame.data.proof);

            if (response.complete) {
                sessionService.secondFactorVerified(frame.original.session);
            }

            return response;
        }
    },

    activatePending: {
        headers: {},
        options: ['user', 'id'],
        data: ['proof'],
        validations: {
            options: {
                user: {required: true},
                id: {required: true},
                proof: {required: true}
            }
        },
        permissions: permissionOnlySelf,
        async query(frame) {
            const model = await models.UsersSecondFactor.findOne({...frame.options, user_id: frame.user.id}, {require: true});
            const changed = await getMfaService().activatePendingFactor(model, frame.data.proof);
            this.headers.cacheInvalidate = changed;
            return model;
        }
    }
};
