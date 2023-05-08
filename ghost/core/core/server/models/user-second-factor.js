const errors = require('@tryghost/errors');
const {getMfaService} = require('../services/auth/multifactor.js');
const ghostBookshelf = require('./base');

const UsersSecondFactor = ghostBookshelf.Model.extend({
    hasTimestamps: false,
    tableName: 'users_second_factors',

    User() {
        return this.belongsTo('User');
    }
}, {
    create(type, userId) {
        const mfaService = getMfaService();
        try {
            return mfaService.defaults(type, userId);
        } catch (err) {
            if (mfaService.isPublicError(err)) {
                throw new errors.ValidationError({message: err.message, err});
            }

            throw err;
        }
    }
});

const UsersSecondFactors = ghostBookshelf.Collection.extend({
    model: UsersSecondFactor
});

module.exports = {
    UsersSecondFactor: ghostBookshelf.model('UsersSecondFactor', UsersSecondFactor),
    UsersSecondFactors: ghostBookshelf.collection('UsersSecondFactors', UsersSecondFactors)
};

