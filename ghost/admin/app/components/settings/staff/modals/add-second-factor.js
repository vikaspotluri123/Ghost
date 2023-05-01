import Component from '@glimmer/component';
import {action} from '@ember/object';
import {inject as service} from '@ember/service';
import {task} from 'ember-concurrency';
import {tracked} from '@glimmer/tracking';

export default class CreateSecondFactorModal extends Component {
    @service notifications;
    @service store;
    @service multiFactorVerification;

    /**
     * @type {{name: string; description: string; type: 'magic-link' | 'backup-code' | 'otp'}}
     */
    model = {};
    element = null;
    @tracked step = 1;
    @tracked factor = null;

    @action
    storeElement(element) {
        this.element = element;
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

    @task({drop: true})
    *createFactorTask() {
        try {
            /** @type {HTMLFormElement} */
            const form = this.element;
            if (!(form?.reportValidity())) {
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
        } catch (error) {
            this.notifications.showAPIError(error, {type: 'error', key: 'factor.create.failed'});
        }
    }

    @task({drop: true})
    *verifyFactorTask() {
        try {
            const factor = yield this.multiFactorVerification.verify();
            this.args.close(factor);
        } catch (error) {
            this.multiFactorVerification.setError(error.message);
        }
    }
}
