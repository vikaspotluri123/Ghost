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

    @action
    storeForm(form) {
        this.form = form;
    }

    willDestroy() {
        super.willDestroy(...arguments);
        this.form = null;
    }

    @task({drop: true})
    *verifyFactorTask() {
        if (!this.form.reportValidity()) {
            return;
        }

        try {
            const newFactor = yield this.multiFactorVerification.activate();
            this.args.close(newFactor);
            return true;
        } catch (error) {
            this.multiFactorVerification.setError(error.message);
        }
    }
}
