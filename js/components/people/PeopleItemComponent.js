import View from '../../lib/wudu/View.js';
import NameRenderer from '../name-render/NameRenderer.js';

export default class PeopleItemComponent extends View {
    static $resolvePath = 'js/components/people';

    set item (data) {
        this.model.data = data;
    }

    init () {
        this.model.nameRenderer = NameRenderer;
    }

    toUpper (value) {
        return value?.toUpperCase();
    }
}