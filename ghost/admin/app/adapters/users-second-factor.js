import ApplicationAdapter from './application';

export default class UserSecondFactor extends ApplicationAdapter {
    urlForCreateRecord = () => this._urlBuilder();
    urlForUpdateRecord = this._urlBuilder;
    urlForDeleteRecord = this._urlBuilder;

    query(store, type, query) {
        if (!query || query.id !== 'me') {
            return super.queryRecord(...arguments);
        }

        let url = this._urlBuilder();
        return this.ajax(url, 'GET', {data: {}}).then((data) => {
            return data;
        });
    }

    /**
     * @param {string} [id]
     */
    _urlBuilder(id) {
        let base = `${this.buildURL('users', 'me')}second-factors/`;
        return id ? `${base}${id}/` : base;
    }
}
