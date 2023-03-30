const {createAddColumnMigration} = require('../../utils');

module.exports = createAddColumnMigration('users', 'mfa_enabled', {
    type: 'boolean',
    nullable: false,
    defaultTo: false
});
