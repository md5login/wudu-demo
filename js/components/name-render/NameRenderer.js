import View from '../../lib/wudu/View.js';

export default class NameRenderer extends View {
    static $resolvePath = 'js/components/name-render';

    set item (item) {
        this.model.item = item;
    }
}