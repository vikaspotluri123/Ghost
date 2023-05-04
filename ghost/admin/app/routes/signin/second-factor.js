import UnauthenticatedRoute from 'ghost-admin/routes/unauthenticated';
import {inject as service} from '@ember/service';

export default class SecondFactorRoute extends UnauthenticatedRoute {
    @service session;
    @service router;

    beforeModel(/* transition */) {
        if (!this.session.waitingForMfa) {
            this.router.transitionTo('signin');
        }
    }

    afterModel() {
        this.store.query('users_second_factor', {id: 'me'}).then((secondFactors) => {
            this.controller.secondFactors = secondFactors;
        });
    }

    buildRouteInfoMetadata() {
        return Object.assign(super.buildRouteInfoMetadata(), {
            titleToken: 'Provide Second Factor'
        });
    }
}
