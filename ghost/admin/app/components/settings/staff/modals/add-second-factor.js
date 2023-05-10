import Component from '@glimmer/component';
import {action} from '@ember/object';
import {inject as service} from '@ember/service';
import {task} from 'ember-concurrency';
import {tracked} from '@glimmer/tracking';

export default class CreateSecondFactorModal extends Component {
    @service notifications;
    @service store;
    /** @type {import('../../../../services/multi-factor-verification.js').default} */
    @service multiFactorVerification;

    /**
     * @type {{name: string; type: 'magic-link' | 'backup-code' | 'otp'}}
     */
    model = {};
    form = null;
    @tracked step = 1;
    @tracked factor = null;

    @action
    storeElement(form) {
        this.form = form;
    }

    @action
    close() {
        this.args.close(this.factor);
    }

    @action
    setModelProperty(property, value) {
        if (value instanceof Event) {
            value = value.target.value;
        }

        this.model[property] = value;
    }

    @action updateType(event) {
        this.setModelProperty('type', event.target.value);
    }

    willDestroy() {
        super.willDestroy(...arguments);
        this.form = null;
    }

    @task({drop: true})
    *createFactorTask() {
        try {
            if (!this.form.reportValidity()) {
                return;
            }

            // CASE: Only the authenticator app is allowed to be created
            if (!('type' in this.model)) {
                this.setModelProperty('type', 'otp');
            }

            let factor = this.store.createRecord('users-second-factor', this.model);

            yield factor.save();
            this.factor = factor;
            this.notifications.closeAlerts('factor.create');
            if (factor.get('status') === 'pending') {
                this.step = 2;
                return;
            }

            this.args.close(factor);
            return true;
        } catch (error) {
            this.notifications.showAPIError(error, {type: 'error', key: 'factor.create.failed'});
        }
    }

    @task({drop: true})
    *verifyFactorTask() {
        if (!this.form.reportValidity()) {
            return;
        }

        try {
            const factor = yield this.multiFactorVerification.activate();
            this.args.close(factor);
            return true;
        } catch (error) {
            this.multiFactorVerification.setError(error.message);
        }
    }
}
