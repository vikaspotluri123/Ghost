import Component from '@glimmer/component';
import {action} from '@ember/object';
import {inject as service} from '@ember/service';
import {task} from 'ember-concurrency';

export default class VerifySecondFactorModal extends Component {
    @service notifications;
    /** @type {import('../../../../services/multi-factor-verification.js').default} */
    @service multiFactorVerification;

    @action
    close() {
        this.args.close(false);
    }

    @task({drop: true})
    *verifyFactorTask() {
        try {
            const newFactor = yield this.multiFactorVerification.verify();
            this.args.close(newFactor);
        } catch (error) {
            this.multiFactorVerification.setError(error.message);
        }
    }
}
