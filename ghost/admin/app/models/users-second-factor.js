import Model, {attr} from '@ember-data/model';

export default Model.extend({
    name: attr('string'),
    status: attr('string'),
    type: attr('string'),
    context: attr({
        defaultValue: '' // Context is only included for shared secrets that have not yet been revealed
    }),

    get niceType() {
        switch (this.get('type')) {
        case 'otp':
            return 'Authenticator';
        case 'backup-code':
            return 'Backup Codes';
        case 'magic-link':
            return 'Magic Link';
        default:
            return 'Unknown';
        }
    }
});
