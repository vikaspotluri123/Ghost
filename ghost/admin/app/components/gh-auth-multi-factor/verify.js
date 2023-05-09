import Component from '@glimmer/component';
import {action} from '@ember/object';
import {getOtpUri} from '@potluri/simple-mfa/browser';
import {inject as service} from '@ember/service';

export default class GhMultiFactorVerify extends Component {
    @service session;
    @service settings;
    /** @type {import('../../services/multi-factor-verification.js').default} */
    @service multiFactorVerification;

    get error() {
        const showError = this.args.showError ?? true;
        return showError && this.multiFactorVerification.error;
    }

    @action
    setProof(event) {
        this.multiFactorVerification.setProof(this.args.factor, event.target.value);
    }

    get isFactorActive() {
        // The factor is active when the secret is no longer exposed in the API
        return !this.args.factor.context;
    }

    get otpUrl() {
        // issuer, account, secret, [label=issuer]
        return getOtpUri(this.settings.title, this.session.user.email, this.otpSecret);
    }

    get otpSecret() {
        return this.args.factor.context.toUpperCase();
    }

    @action
    setFactorWithNoProof() {
        this.multiFactorVerification.setProof(this.args.factor);
    }
}
