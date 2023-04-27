import ApplicationSerializer from './application';
import {pluralize} from 'ember-inflector';
import {underscore} from '@ember/string';

export default class UsersSecondFactorSerializer extends ApplicationSerializer {
    serialize(snapshot/* , options */) {
        const response = {};

        for (const [key, [/* oldValue */, newValue]] of Object.entries(snapshot.changedAttributes())) {
            response[key] = newValue;
        }

        return response;
    }

    serializeIntoHash(hash, type, record, options) {
        // The default serializer uses the model name which is kebab cased.
        // The API expects the model name to be snake cased - perform the mapping here
        super.serializeIntoHash(hash, type, record, options);

        const kebabKey = pluralize(type.modelName);
        const snakeKey = underscore(kebabKey);
        hash[snakeKey] = hash[kebabKey];
        delete hash[kebabKey];
    }
}
