import Controller from '../../lib/wudu/Controller.js';
import MainView from './MainView.js';

export default class MainController extends Controller {
    async activate () {
        this.view = new MainView();
        return super.activate();
    }

    async updateState (state) {
        return super.updateState();
    }

    async deactivate () {
        this.view?.dispose();
        return super.deactivate();
    }
}