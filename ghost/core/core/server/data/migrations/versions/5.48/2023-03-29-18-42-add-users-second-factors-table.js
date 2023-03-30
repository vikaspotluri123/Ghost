const {addTable} = require('../../utils');

module.exports = addTable('users_second_factors', {
    id: {type: 'string', maxlength: 24, nullable: false, primary: true},
    user_id: {type: 'string', maxlength: 24, nullable: false, references: 'users.id'},
    name: {type: 'string', maxlength: 191, nullable: false},
    status: {type: 'string', maxlength: 50, nullable: false, validations: {isIn: [['pending', 'active', 'disabled']]}},
    type: {type: 'string', maxlength: 50, nullable: false},
    context: {type: 'string', maxlength: 2000, nullable: true}
});
