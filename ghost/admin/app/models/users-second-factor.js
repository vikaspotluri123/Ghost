import Model, {attr} from '@ember-data/model';

export default Model.extend({
    name: attr('string'),
    description: attr('string'),
    status: attr('string'),
    type: attr('string'),
    context: attr('string', {
        defaultValue: '' // Context is only included for shared secrets that have not yet been revealed
    })
});
