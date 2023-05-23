import Phaser from "phaser";

export default class Lobby extends Phaser.Scene{
    constructor(){
        super('lobby');
    }

    create() {
        this.add.text(20, 20, "Loading game...");
        setTimeout(() => {
            this.scene.start('game');
        });
    }
}