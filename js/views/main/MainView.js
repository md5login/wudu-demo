import View from '../../lib/wudu/View.js';
import WuduObject from '../../lib/wudu/data/WuduObject.js';
import WuduArray from '../../lib/wudu/data/WuduArray.js';
import PeopleItemComponent from '../../components/people/PeopleItemComponent.js';

class PeopleItem extends WuduObject {
    static $struct = {
        name: {type: 'string'}
    };
}

class ViewModel extends WuduObject {
    static $state = {
        people: {type: WuduArray.from(PeopleItem)}
    };
}

export default class MainView extends View {
    static $parent = 'body';
    static $resolvePath = 'js/views/main';
    static $modelType = ViewModel;

    async init () {
        this.model.people = (await fetch('https://swapi.dev/api/people').then(r => r.json())).results;
        this.model.peopleItemComponent = PeopleItemComponent;
        console.log(this.model.people);
    }

    filterLuke (value) {
        return value?.toLowerCase()?.startsWith('luke');
    }

    toPixel (value) {
        return `${value.length}px`;
    }

    addPerson () {
        this.model.people.push({
            name: Math.random(),
            height: 132
        });
    }
}