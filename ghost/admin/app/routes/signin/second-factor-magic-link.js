import UnauthenticatedRoute from 'ghost-admin/routes/unauthenticated';
import {inject as service} from '@ember/service';

export default class SecondFactorRoute extends UnauthenticatedRoute {
    @service session;
    @service router;

    _factorId;
    _factorProof;

    beforeModel(/* transition */) {
        if (!this.session.waitingForMfa) {
            this.router.transitionTo('signin');
        }
    }

    model(params) {
        this._factorId = params.factor;
        this._factorProof = params.factor_proof;
    }

    setupController(controller/* , model */) {
        controller.factorId = this._factorId;
        controller.factorProof = this._factorProof;
    }

    buildRouteInfoMetadata() {
        return Object.assign(super.buildRouteInfoMetadata(), {
            titleToken: 'Log in with Magic Link'
        });
    }
}
