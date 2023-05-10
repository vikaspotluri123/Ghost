import Component from '@glimmer/component';
import {action} from '@ember/object';
import {inject as service} from '@ember/service';
import {task} from 'ember-concurrency';

export default class DeleteSecondFactorModal extends Component {
    @service notifications;
    @service store;

    @action
    close() {
        this.args.close(false);
    }

    @task({drop: true})
    *deleteFactorTask() {
        let success = false;
        try {
            const {factor} = this.args.data;

            yield factor.destroyRecord();

            this.notifications.closeAlerts('factor.delete');
            success = true;
        } catch (error) {
            this.notifications.showAPIError(error, {type: 'error', key: 'factor.delete.failed'});
        } finally {
            this.args.close(success);
            return success;
        }
    }
}
