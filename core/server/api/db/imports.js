const Promise = require('lodash');
const pipeline = require('../lib/promise/pipeline');
const localUtils = require('../utils');
const importer = require('../../data/importer');
const {EXCLUDED_TABLES} = require('../../data/exporter');

const docName = 'db';
const tasks = [
    localUtils.handlePermissions(docName, 'importContent'),
    localUtils.convertOptions(EXCLUDED_TABLES, null, {forModel: false}),
    importContent
];

let knownFiles = [];
let state = {
    errors: [],
    importing: false,
    lastAction: false
};

function importContent({fileName, include}) {
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

module.exports.addKnownFile = ({fileName}) => {
    knownFiles.push(fileName);
    return Promise.resolve(fileName);
};

/**
 * ### Import Content
 * Import posts, tags etc from a JSON blob
 *
 * @public
 * @param {{context}} options
 * @returns {Promise} import state (same as getStatus)
 */
module.exports.run = function importContent(options = {}) {
    if (state.importing) {
        return Promise.reject(new Error('TODO_FIXME_ALREADY_IMPORTING'));
    }

    if (!options.fileName) {
        return Promise.reject(new Error('TODO_FIXME_FILENAME_NOT_SUPPLIED'));
    }

    if (!knownFiles.includes(options.fileName)) {
        return Promise.reject(new Error('TODO_FIXME_UNSAFE_FILENAME_PASSED'));
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
 * @public
 * @param {{context}} options
 * @returns {Promise} Success
 */
module.exports.legacy = function deprectaedImport(options) {
    return pipeline(tasks, options || {});
};
