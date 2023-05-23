

import Phaser from "phaser";

export default class Game extends Phaser.Scene {
    constructor() {
        super('game');
    }

    create() { 
        this.add.text(20, 20, 'Playing game!');
    }

}
