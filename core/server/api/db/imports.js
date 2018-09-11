const Promise = require('lodash');
const pipeline = require('../lib/promise/pipeline');
const localUtils = require('../utils');
const importer = require('../../data/importer');
const {EXCLUDED_TABLES} = require('../../data/exporter');

const docName = 'db';
const tasks = [
    localUtils.handlePermissions(docName, 'importContent'),
    localUtils.convertOptions(EXCLUDED_TABLES, null, {forModel: false}),
    runImporter
];

let state = {
    errors: [],
    importing: false,
    lastAction: false
};

function runImporter({fileName, include}) {
    return importer.importFromFile(fileName, {include})
        // NOTE: response can contain 2 objects if images are imported
        .then((response) => {
            return {
                db: [],
                problems: response[response.length === 2 ? 1 : 0].problems
            };
        });
}

module.exports.status = () => {
    return Promise.resolve(state);
};

/**
 * ### Import Content
 * Import posts, tags etc from a JSON blob
 *
 * @public
 * @param {{context}} options
 * @returns {Promise} import state (same as getStatus)
 */
module.exports.async = function importContent(options = {}) {
    if (state.importing) {
        return Promise.reject(new Error('TODO_FIXME_ALREADY_IMPORTING'));
    }

    state.importing = true;

    pipeline(tasks, options).then(({problems}) => {
        state.importing = false;
        if (problems && problems.length) {
            // @todo: determine how to check for warnings?
            state.lastAction = 'error';
            state.errors = problems;
        } else {
            state.lastAction = 'success';
            state.errors = [];
        }
    }).catch((error) => {
        state.importing = false;
        state.lastAction = 'error';
        state.errors = [error];
    });

    return Promise.resolve({state});
};

/**
 * ### Import Content
 * Import posts, tags etc from a JSON blob
 *
 * @deprecated
 * @public
 * @param {{context}} options
 * @returns {Promise} Success
 */
module.exports.importContent = function executeLegacyImport(options) {
    return pipeline(tasks, options || {});
};
