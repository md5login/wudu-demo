import Router from './lib/wudu/Router.js';
import MainController from './views/main/MainController.js';
import './lib/wudu/dom/common-modifiers.js';

Router.init([
    {
        pattern: /\//,
        controller: MainController,
        name: 'MainController'
    }
]);