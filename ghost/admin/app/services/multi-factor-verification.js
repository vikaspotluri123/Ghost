import Service, {inject as service} from '@ember/service';
import {action} from '@ember/object';
import {tracked} from '@glimmer/tracking';

export default class MultiFactorVerificationService extends Service {
    /** @type {ReturnType<import('../utils/ghost-paths.js').default>} */
    @service ghostPaths;
    @service ajax;
    @service store;

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
        if (!this._factor) {
            throw new Error('Something went wrong - factor is missing internally');
        }

        const forActivation = this._factor.status === 'pending';

        if (this._factor.type === 'otp') {
            if (!this._proof.match(/^\d{6}$/)) {
                throw new Error('OTP must be 6 digits');
            }
        } else if (this._factor.type === 'backup-code') {
            if (forActivation) {
                this._proof = 'acknowledged';
            } else {
                const originalProof = this._proof;
                this._proof = this._proof.replace(/\D/g, '');
                if (!this._proof.match(/^\d{12}$/)) {
                    this._proof = originalProof;
                    throw new Error(`Backup code must be 12 digits, optionally with dashes (-) in between`);
                }
            }
        }

        const url = this.ghostPaths.url.api('/users/me/second-factors', this._factor.id, 'activate');

        return this.ajax.post((url), {
            data: {proof: this._proof},
            contentType: 'application/json;charset=utf-8'
        }).then((response) => {
            if (!response.users_second_factors?.[0]) {
                throw new Error('Factor probably activated, but unable to understand the response');
            }

            const jsonModel = response.users_second_factors[0];
            const attributes = {...jsonModel};
            delete attributes.id;

            const record = this.store.push({
                data: [{
                    id: jsonModel.id,
                    type: 'users-second-factor',
                    attributes,
                    relationships: {}
                }]
            });

            return record[0];
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
