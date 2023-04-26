import Service, {inject as service} from '@ember/service';
import {action} from '@ember/object';
import {tracked} from '@glimmer/tracking';

export default class MultiFactorVerificationService extends Service {
    /** @type {ReturnType<import('../utils/ghost-paths.js').default>} */
    @service ghostPaths;
    @service ajax;

    _proof = '';
    _factor = null;

    @tracked error = null;

    @action
    setProof(factor, proof) {
        this._proof = proof;
        this._factor = factor;
    }

    setError(error) {
        this.error = error;
    }

    verify() {
        if (!this._factor || !this._proof.match(/^\d{6}$/)) {
            throw new Error('OTP must be 6 digits');
        }

        const url = this.ghostPaths.url.api('/users/me/second-factors', this._factor.id, 'activate');

        return this.ajax.post((url), {
            data: {proof: this._proof},
            contentType: 'application/json;charset=utf-8'
        }).then((response) => {
            if (!response.users_second_factors?.[0]) {
                throw new Error('Factor probably activated, but unable to understand the response');
            }

            return response.users_second_factors[0];
        }).catch((error) => {
            const originalError = error.payload?.errors[0];
            throw originalError || error;
        });
    }

    deactivate() {
        this._proof = '';
        this._factor = null;
        this.error = null;
    }
}
