import Controller from '@ember/controller';
import {action} from '@ember/object';
import {inject} from 'ghost-admin/decorators/inject';
import {inject as service} from '@ember/service';
import {tracked} from '@glimmer/tracking';

export default class SecondFactorController extends Controller {
    /** @type {import('../../services/multi-factor-verification.js').default} */
    @service multiFactorVerification;
    @inject config;
    /** @type {string | undefined} */
    @tracked factorId;
    /** @type {string | undefined} */
    @tracked factorProof;

    get canSelectAnotherFactor() {
        return Boolean(this.multiFactorVerification.error);
    }

    @action
    async sendProof() {
        if (!this.factorId || !this.factorProof) {
            this.multiFactorVerification.setError('Invalid magic link');
            return;
        }

        try {
            this.multiFactorVerification.setProof({id: this.factorId}, this.factorProof);
            await this.multiFactorVerification.verify();
        } catch (error) {
            this.multiFactorVerification.setError(error.message);
        }
    }
}
