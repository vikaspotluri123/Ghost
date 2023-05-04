import Controller from '@ember/controller';
import {action} from '@ember/object';
import {inject} from 'ghost-admin/decorators/inject';
import {inject as service} from '@ember/service';
import {task} from 'ember-concurrency';
import {tracked} from '@glimmer/tracking';

export default class SecondFactorController extends Controller {
    /** @type {import('../../services/multi-factor-verification.js').default} */
    @service multiFactorVerification;
    @inject config;
    /** @type {import('ember').Ember.ArrayProxy} */
    @tracked _secondFactors;
    @tracked _selectedFactor = 0;
    @tracked activeView = 1;
    @tracked userCanDoSomething = true;

    /** @param {import('ember').Ember.ArrayProxy} value */
    set secondFactors(value) {
        this._secondFactors = value.filter(factor => factor.status === 'active');
    }

    get secondFactors() {
        return this._secondFactors;
    }

    get selectedFactor() {
        return this.secondFactors?.objectAt(this._selectedFactor);
    }

    get canSelectAnotherFactor() {
        return this.userCanDoSomething && this._secondFactors?.length > 1;
    }

    @action
    storeForm(form) {
        this.form = form;
    }

    @action
    selectFactor() {
        this.activeView = 2;
    }

    @action
    setSelectedFactor(index) {
        this._selectedFactor = index;
        this.activeView = 1;
    }

    willDestroy() {
        super.willDestroy(...arguments);
        this.form = null;
    }

    @task({drop: true})
    *submitTask() {
        if (!this.form.reportValidity()) {
            return;
        }

        try {
            const response = yield this.multiFactorVerification.verify();

            if (response && 'complete' in response && !response.complete) {
                this.userCanDoSomething = false;
            }
        } catch (error) {
            this.multiFactorVerification.setError(error.message);
        }
    }
}
