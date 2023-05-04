import Service, {inject as service} from '@ember/service';
import {action} from '@ember/object';
import {tracked} from '@glimmer/tracking';

export const FactorType = {
    backupCode: 'backup-code',
    OTP: 'otp',
    magicLink: 'magic-link'
};

export const FactorStatus = {
    pending: 'pending',
    active: 'active',
    disabled: 'disabled'
};

export default class MultiFactorVerificationService extends Service {
    /** @type {ReturnType<import('../utils/ghost-paths.js').default>} */
    @service ghostPaths;
    @service ajax;
    @service store;
    /** @type {import('./session.js').default} */
    @service session;

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

    activate() {
        this._assertFactor();

        // CASE: somehow the factor was requested to be verified but it's already verified.
        if (this._factor.status !== FactorStatus.pending) {
            // @TODO: Return a model
            return this._factor;
        }

        if (this._factor.type === FactorType.OTP) {
            this._checkOtp();
        } else if (this._factor.type === FactorType.backupCode) {
            this._proof = 'acknowledged';
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

    verify() {
        this._assertFactor();
        if (this._factor.type === FactorType.OTP) {
            this._checkOtp();
        } else if (this._factor.type === FactorType.backupCode) {
            const originalProof = this._proof;
            this._proof = this._proof.replace(/\D/g, '');
            if (!this._proof.match(/^\d{12}$/)) {
                this._proof = originalProof;
                throw new Error(`Backup code must be 12 digits, optionally with dashes (-) in between`);
            }
        }

        const url = this.ghostPaths.url.api('/session/second-factor');
        return this.ajax.post((url), {
            data: {factor_id: this._factor.id, proof: this._proof},
            contentType: 'application/json;charset=utf-8'
        }).then((response) => {
            if (!response.users_second_factors?.[0]) {
                throw new Error('You probably provided the correct factor, but unable to understand the response');
            }

            const {complete, success, message} = response.users_second_factors[0];

            if (!success) {
                throw new Error('Proof processing failed');
            }

            if (complete) {
                return this.session.handleAuthentication();
            }

            this.setError(message);
            return {complete};
        }).catch((error) => {
            const originalError = error.payload?.errors[0];
            throw originalError || error;
        });
    }

    _assertFactor() {
        if (!this._factor) {
            throw new Error('Something went wrong - factor is missing internally');
        }
    }

    _checkOtp() {
        if (!this._proof.match(/^\d{6}$/)) {
            throw new Error('OTP must be 6 digits');
        }
    }

    deactivate() {
        this._proof = '';
        this._factor = null;
        this.error = null;
    }
}
