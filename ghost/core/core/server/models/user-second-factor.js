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
        return getMfaService().defaults(type, userId);
    }
});

const UsersSecondFactors = ghostBookshelf.Collection.extend({
    model: UsersSecondFactor
});

module.exports = {
    UsersSecondFactor: ghostBookshelf.model('UsersSecondFactor', UsersSecondFactor),
    UsersSecondFactors: ghostBookshelf.collection('UsersSecondFactors', UsersSecondFactors)
};

