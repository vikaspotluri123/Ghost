const {getMfaService} = require('../../../../services/auth/multifactor.js');
const {addSetting} = require('../../utils/settings.js');

module.exports = addSetting({
    key: 'second_factor_secrets',
    value: getMfaService().syncSecrets(),
    type: 'json',
    group: 'core'
});
