//const express = require('express');
import express from 'express';

const app = express();

//const http = require('http');
import http from 'http';
const server = http.createServer(app);

import { Server } from 'socket.io';
//const { Server } = require('socket.io');
const io = new Server(server);

import { fileURLToPath } from 'url';
import { dirname } from 'path';

import fetch from 'node-fetch';
import { SocketAddress } from 'net';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class Player {
    constructor(x, y, id, spriteList, socket_id, name){
        this.x = x; //player x coordinate
        this.y = y; //player y coordinate
        this.velocity_x = 0;
        this.velocity_y = 0;
        this.id = id; //uniquely identifies each player
        this.spriteList = spriteList;
        this.texture = this.spriteList[2];
        this.socket_id = socket_id;
        this.score = 0; //player score from killing bugs
        this.name = name;
        this.hp = 100;
        this.isDead = false;
        this.sprite_rotation = 0;
    }
}





const sprites = {
    0: ["player1_north", "player1_south", "player1_east", "player1_west"],
    1: ["player2_north", "player2_south", "player2_east", "player2_west"],
    2: ["player3_north", "player3_south", "player3_east", "player3_west"],
    3: ["player4_north", "player4_south", "player4_east", "player4_west"]
}

app.use(express.static("images"));
app.use(express.static("audio"));
app.use(express.static("script"));

var max_players = 4;
var players = [null, null, null, null];
var draw_queue = [];
var audio_queue = [];
var curr_id = 0;
var GAME_STARTED = false;
var GAME_ENDED = false;

var GAME_PHASE = 0;
var WAVE_NUMBER = 1;

var SERVER_NAME = "";
var SERVER_NUMBER = "";
var LOBBY_PASSCODE = "";
var API_SERVER = "localhost";
var FRONTEND_HOST = "";
var FRONTEND_PORT = "";

const red_crawler_drop_table = {
    50: null, //50% chance to drop nothing
    75: "assault_rifle_shimmer", //these are animation names, for the pickup sprites
    85: "medpack_small_shimmer",
    100: "pump_shotgun_shimmer",
}

const blue_crawler_drop_table = {
    40: null,
    60: "assault_rifle_shimmer",
    80: "pump_shotgun_shimmer",
    90: "medpack_small_shimmer",
    100: "submachine_gun_shimmer"
}

const giant_crawler_drop_table = {
    30: null,
    50: "assault_rifle_shimmer",
    70: "mini_shotgun_shimmer",
    80: "medpack_large_shimmer",
    100: "submachine_gun_shimmer"
}

const jewel_spider_drop_table = {
    30: null,
    60: "mini_shotgun_shimmer",
    80: "medpack_large_shimmer",
    100: "submachine_gun_shimmer"
}

const acid_spitter_drop_table = {
    20: null,
    50: "submachine_gun_shimmer",
    70: "medpack_large_shimmer",
    100: "carbine_shimmer"
}



class Bug {
    constructor(name, x, y, hp, max_hp, attack_power, movement_speed, score, isOnFire){
        this.name = name;
        this.id = this.createID();
        this.x = x;
        this.y = y;
        this.hp = hp;
        this.max_hp = max_hp;
        this.attack_power = attack_power;
        this.movement_speed = movement_speed;
        this.score = score; //score gained from killing this bug
        this.isOnFire = isOnFire;
        this.isAlive = true;
        this.last_gasp = false;

        this.dropped_item = -1;
        this.drop_table = null;

        this.shootingCooldown = false;
        
    }

    createID(){
        let result = '';
        const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        const charactersLength = characters.length;
        let counter = 0;
        while (counter < 5) {
          result += characters.charAt(Math.floor(Math.random() * charactersLength));
          counter += 1;
        }
        return result;
    }

    calculateDistance(x1, y1, x2, y2){
        let rise = x2 - x1;
        let run = y2 - y1;
        return Math.sqrt(Math.pow(rise, 2) + Math.pow(run, 2));
    }

    aggro(){
        //figure out which player is the closest
        let max_distance = 999999;
        let max_distance_player_id = -1;
        players.forEach((player) => {
            if(player != null && !player.isDead){
                let distance = this.calculateDistance(this.x, this.y, player.x, player.y);
                if(distance < max_distance){
                    max_distance = distance;
                    max_distance_player_id = player.id;
                }
            }
        });
        return {
            id: max_distance_player_id
        }
    }

    setDropTable(drop_table){
        this.drop_table = drop_table;
        let keys = Object.keys(this.drop_table);
        let int_keys = keys.map(function(key) {
            let int_key = parseInt(key)
            return int_key
        });
        int_keys.sort(function(a, b){
            return a - b;
        });
        let drop_sample = Math.floor(100 * Math.random());
    
        for(const drop_chance in int_keys){
            if(drop_sample < int_keys[drop_chance]){
                this.dropped_item = this.drop_table[int_keys[drop_chance]];
                break;
            }
        }
 
    }

    shooterAI(player_id){
        //AI used by the acid spitter
        if(players[player_id] != null){
            let player_x = players[player_id].x;
            let player_y = players[player_id].y;

            let player_distance = this.calculateDistance(this.x, this.y, player_x, player_y);
            if(player_distance > 400 || this.x > 800 || this.y > 600){
                //close the gap between the bug and the player
                //use the follower AI pattern
                let retval = this.followerAI(player_id);
                retval["shoot"] = false;
                retval["target"] = null;
                return retval;
            } else {
                //calculate angle to player
                let angle = Math.atan2(player_y - this.y, player_x - this.x);
                let shoot = false;
                if(!this.shootingCooldown){
                    this.shootingCooldown = true;
                    shoot = true;
                    var that = this;
                    setTimeout(function () {
                        that.shootingCooldown = false;
                    }, 2000);
                }

                return {
                    angle: angle,
                    speed: 0, //stop moving
                    prev_expected_enemy_x: this.x,
                    prev_expected_enemy_y: this.y,
                    hp: this.hp,
                    isAlive: this.isAlive,
                    okToFire: true,
                    shoot: shoot,
                    target: {
                        x: player_x,
                        y: player_y
                    },
                    dropped_item: this.dropped_item
                }
            }
        }
    }

    followerAI(player_id){
        //AI used by the crawlers
        //get the angle to the player with player_id 
        if(players[player_id] != null){
            let player_x = players[player_id].x;
            let player_y = players[player_id].y;
            //let player_distance = this.calculateDistance(this.x, this.y, player_x, player_y);
            let angle = Math.atan2(player_y - this.y, player_x - this.x);

            let tmp_x = this.x;
            let tmp_y = this.y;

            let after_x = this.x + (this.movement_speed * Math.cos(angle));
            let after_y = this.y + (this.movement_speed * Math.sin(angle));
            //console.log("After x: " + after_x + " After y: " + after_y);
            if(GAME_STARTED){
                this.x = after_x;
                this.y = after_y;
            }
            
            return {
                angle: angle,
                speed: this.movement_speed * 10,
                prev_expected_enemy_x: tmp_x,
                prev_expected_enemy_y: tmp_y,
                hp: this.hp,
                isAlive: this.isAlive,
                dropped_item: this.dropped_item
            };
        }
        return {
            angle: 0,
            speed: 0,
            prev_expected_enemy_x: this.x,
            prev_expected_enemy_y: this.y,
            hp: this.hp,
            isAlive: this.isAlive,
            dropped_item: this.dropped_item
        }

    }

    calculateMovementData(player_id){
        let closest_player = this.aggro();
        if(closest_player.id != -1){
            if(this.name == "Acid Spitter"){
                return this.shooterAI(closest_player.id);
            } else {
                return this.followerAI(closest_player.id);
            }
        } else {
            return {
                angle: 0,
                speed: 0,
                prev_expected_enemy_x: this.x,
                prev_expected_enemy_y: this.y,
                hp: this.hp,
                isAlive: this.isAlive,
                okToFire: false,
                shoot: false,
                target: null,
                droppped_item: this.dropped_item
            }
        }
    }
}


app.get('/', (req, res) => {
    if(curr_id < 4 && GAME_STARTED == false){
        res.sendFile(__dirname + '/index.html');
    } else {
        if(curr_id >= 4){
            res.sendFile(__dirname + '/fullgame.html');
        } else if (GAME_STARTED == true){
            res.sendFile(__dirname + '/game_started.html');
        }
    }
});


//var bug1 = new Bug("Bug 1", 900, 300, 100, 100, 10, 6, false);

var enemies = new Map();

var socket_map = new Map();

//enemies.set(bug1.id, bug1);

function getPlayerDataCallbackFunction(player){
    if(player == null){
        return player;
    } else {
        return {
            x: player.x,
            y: player.y,
            isDead: player.isDead,
            velocity_x: player.velocity_x,
            velocity_y: player.velocity_y,
            texture: player.texture,
            name: player.name,
            score: player.score,
            sprite_rotation: player.sprite_rotation,
        };
    }
}


//global data structure to keep track of kills for game progression
let kills = {
    "Red Crawler": 0,
    "Blue Crawler": 0,
    "Giant Crawler": 0,
    "Jewel Spider": 0,
    "Acid Spitter": 0,
    "total": 0
}

function getSpawnsTesting(){
    if(GAME_PHASE === 1){
        if(kills["Red Crawler"] >= 10){
            GAME_PHASE = 2;
        }
    } else if (GAME_PHASE === 2){
        if(kills["Red Crawler"] >= 20 && kills["Blue Crawler"] >= 10){
            GAME_PHASE = 7;
        }
    }
    if(GAME_PHASE === 1){
        return {
            percentages: {
                "Red Crawler": 100
            },
            spawn_group_size: 5,
            spawn_group_frequency: 10
        }
    } else if (GAME_PHASE === 2){
        return {
            percentages: {
                "Red Crawler": 50,
                "Blue Crawler": 100,
            },
            spawn_group_size: 5,
            spawn_group_frequency: 10
        }        
    }   else if (GAME_PHASE === 7){

        GAME_ENDED = true;
        console.log("You won!!!!");
        console.log(FRONTEND_HOST)
        console.log(FRONTEND_PORT)
        io.emit("victory", {
            frontend_host: FRONTEND_HOST,
            frontend_port: FRONTEND_PORT
        });

        return {
            percentages: {
                "Red Crawler": 0,
                "Blue Crawler": 0,
                "Giant Crawler": 0,
                "Jewel Spider": 0,
                "Acid Spitter": 0,
            },
            spawn_group_size: 0,
            spawn_group_frequency: 10000000
        }
    }  

}

function getSpawnsDemo(){
    if(GAME_PHASE === 1){
        if(kills["Red Crawler"] >= 10){
            GAME_PHASE = 2;
        }
    } else if (GAME_PHASE === 2){
        if(kills["Red Crawler"] >= 15 && kills["Blue Crawler"] >= 5){
            GAME_PHASE = 3;
        }
    } else if (GAME_PHASE === 3){
        if(kills["Blue Crawler"] >= 10 && kills["Giant Crawler"] >= 8){
            GAME_PHASE = 4;
        }
    } else if (GAME_PHASE == 4){
        if(kills["Giant Crawler"] >= 12 && kills["Jewel Spider"] >= 5){
            GAME_PHASE = 5;
        }
    } else if (GAME_PHASE == 5){
        if(kills["Jewel Spider"] >= 10 && kills["Acid Spitter"] >= 6){
            GAME_PHASE = 6;
        }
    } else if (GAME_PHASE == 6){
        if(kills["total"] >= 50){
            GAME_PHASE = 7;
        }
    }
    if(GAME_PHASE === 1){
        return {
            percentages: {
                "Red Crawler": 100
            },
            spawn_group_size: 5,
            spawn_group_frequency: 10
        }
    } else if (GAME_PHASE === 2){
        return {
            percentages: {
                "Red Crawler": 50,
                "Blue Crawler": 100,
            },
            spawn_group_size: 5,
            spawn_group_frequency: 10
        }        
    } else if (GAME_PHASE === 3){
        return {
            percentages: {
                "Red Crawler": 40,
                "Blue Crawler": 80,
                "Giant Crawler": 100
            },
            spawn_group_size: 7,
            spawn_group_frequency: 10
        }
    } else if (GAME_PHASE === 4){
        return {
            percentages: {
                "Red Crawler": 15,
                "Blue Crawler": 55,
                "Giant Crawler": 80,
                "Jewel Spider": 100 
            },
            spawn_group_size: 10,
            spawn_group_frequency: 10
        }
    } else if (GAME_PHASE === 5){
        return {
            percentages: {
                "Red Crawler": 10,
                "Blue Crawler": 40,
                "Giant Crawler": 65,
                "Jewel Spider": 85,
                "Acid Spitter": 100
            },
            spawn_group_size: 14,
            spawn_group_frequency: 10
        }
    } else if (GAME_PHASE === 6){
        return {
            percentages: {
                "Blue Crawler": 20,
                "Giant Crawler": 50,
                "Jewel Spider": 75,
                "Acid Spitter": 100
            },
            spawn_group_size: 14,
            spawn_group_frequency: 8
        }
    } else if (GAME_PHASE === 7){
        //victory!
        GAME_ENDED = true;
        io.emit("victory", {
            frontend_host: FRONTEND_HOST,
            frontend_port: FRONTEND_PORT
        })

        return {
            percentages: {
                "Red Crawler": 0,
                "Blue Crawler": 0,
                "Giant Crawler": 0,
                "Jewel Spider": 0,
                "Acid Spitter": 0,
            },
            spawn_group_size: 0,
            spawn_group_frequency: 10000000
        }
    } 
}

function getSpawns(){
    //first figure out if a game phase change needs to occur based on certain criteria (number of kills)
    if(GAME_PHASE === 1){
        if(kills["Red Crawler"] >= 10){
            GAME_PHASE = 2;
        }
    } else if (GAME_PHASE === 2){
        if(kills["Red Crawler"] >= 20 && kills["Blue Crawler"] >= 10){
            GAME_PHASE = 3;
        }
    } else if (GAME_PHASE === 3){
        if(kills["Blue Crawler"] >= 30 && kills["Giant Crawler"] >= 10){
            GAME_PHASE = 4;
        }
    } else if (GAME_PHASE == 4){
        if(kills["Giant Crawler"] >= 15 && kills["Jewel Spider"] >= 10){
            GAME_PHASE = 5;
        }
    } else if (GAME_PHASE == 5){
        if(kills["Jewel Spider"] >= 15 && kills["Acid Spitter"] >= 10){
            GAME_PHASE = 6;
        }
    } else if (GAME_PHASE == 6){
        if(kills["total"] >= 200){
            GAME_PHASE = 7;
        }
    }
    if(GAME_PHASE === 1){
        return {
            percentages: {
                "Red Crawler": 100
            },
            spawn_group_size: 5,
            spawn_group_frequency: 10
        }
    } else if (GAME_PHASE === 2){
        return {
            percentages: {
                "Red Crawler": 50,
                "Blue Crawler": 100,
            },
            spawn_group_size: 5,
            spawn_group_frequency: 10
        }        
    } else if (GAME_PHASE === 3){
        return {
            percentages: {
                "Red Crawler": 40,
                "Blue Crawler": 80,
                "Giant Crawler": 100
            },
            spawn_group_size: 7,
            spawn_group_frequency: 10
        }
    } else if (GAME_PHASE === 4){
        return {
            percentages: {
                "Red Crawler": 15,
                "Blue Crawler": 55,
                "Giant Crawler": 80,
                "Jewel Spider": 100 
            },
            spawn_group_size: 10,
            spawn_group_frequency: 10
        }
    } else if (GAME_PHASE === 5){
        return {
            percentages: {
                "Red Crawler": 10,
                "Blue Crawler": 40,
                "Giant Crawler": 65,
                "Jewel Spider": 85,
                "Acid Spitter": 100
            },
            spawn_group_size: 14,
            spawn_group_frequency: 10
        }
    } else if (GAME_PHASE === 6){
        return {
            percentages: {
                "Blue Crawler": 20,
                "Giant Crawler": 50,
                "Jewel Spider": 75,
                "Acid Spitter": 100
            },
            spawn_group_size: 14,
            spawn_group_frequency: 8
        }
    } else if (GAME_PHASE === 7){
        //victory!
        GAME_ENDED = true;
        io.emit("victory", {
            frontend_host: "www.google.com",
            frontend_port: ""
        })

        return {
            percentages: {
                "Red Crawler": 0,
                "Blue Crawler": 0,
                "Giant Crawler": 0,
                "Jewel Spider": 0,
                "Acid Spitter": 0,
            },
            spawn_group_size: 0,
            spawn_group_frequency: 10000000
        }
    }
}


io.on('connection', (socket) => {
    console.log("A user connected");
    console.log("Socket " + socket.id + " connected.");
    console.log(socket.handshake);
    console.log((curr_id + 1) + " users currently connected");

    if(curr_id < max_players){
        let name = "defaultname";
        players[curr_id] = new Player(
            300 + Math.floor(200 * Math.random()), 
            300 + Math.floor(200 * Math.random()), 
            curr_id,
            sprites[curr_id],
            socket.id,
            name
        );

        fetch("http://" + API_SERVER + ":3050/name/getname", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({
                server_passcode: LOBBY_PASSCODE,
                player_id: curr_id
            })
        }).then((res) => res.json())
        .then((res) => {
            if(res.status == "success"){
                players[curr_id].name = res.data;
            }
        })
        /*
        if(curr_id === 0){
            name = "Adam";
        } else if (curr_id === 1){
            name = "Bob";
        } else if (curr_id === 2){
            name = "Charlie";
        }  else if (curr_id === 3){
            name = "Daniel"
        }
        */

    }

    socket.on('query-players', (player_uuid, callback_func) => {
        //query-players is received when a new player joins
        console.log("query players called");
        console.log("Player UUID: " + player_uuid);
        
        let player_id = null;
        players.map((player) => {
            if(player != null && player.socket_id == player_uuid){
                console.log("This player was already playing");
                player_id = player.id;
            }
        });


        callback_func({
            num_players: curr_id,
            id: curr_id, //when a player connects, notify them of their id, along with other important info
            socket_id: players[curr_id].socket_id,
            SERVER_NAME: SERVER_NAME,
            SERVER_NUMBER: SERVER_NUMBER,
            LOBBY_PASSCODE: LOBBY_PASSCODE,
            player_coords: players.map(player => getPlayerDataCallbackFunction(player))
        });

        io.emit("new player", {
            //send a message to all players notifying them of the new player
            id: curr_id,
            player_data: players.map(player => getPlayerDataCallbackFunction(player))
        });

        curr_id += 1;

        fetch("http://" + API_SERVER + ":3050/server/playerjoined", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({
                server_number: SERVER_NUMBER,
                n_players: curr_id
            })
        });
    });

    socket.on("game-start", ()=> {
        console.log("Host started the game!");
        GAME_STARTED = true;
        GAME_PHASE = 1;
        io.emit("start-game");

        fetch("http://" + API_SERVER + ":3050/startgame", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({
                server_number: SERVER_NUMBER
            })
        }).then((res) => res.json())
        .then((res) => {
            if(res.status == "failure"){
                console.log("Failed to communicate to the server that the game started.");
            }
        });

    });

    socket.on("hello", (player_id) => {
        console.log("Received a hello from the game!");
        console.log("Game Socket ID: " + socket.id);
        players[player_id].socket_id = socket.id;
    });

    socket.on("update item", (arg1, arg2, callback) => {
        console.log(arg1); // 1
        console.log(arg2); // { name: "updated" }
        callback({
          status: "ok"
        });
    });

    socket.on("update-server", (update) => {
        var moved_player_id = update.id;
        //console.log(movement.texture);
        if(players[moved_player_id] != null){
            players[moved_player_id].x = update.x;
            players[moved_player_id].y = update.y;
            players[moved_player_id].velocity_x = update.velocity_x;
            players[moved_player_id].velocity_y = update.velocity_y;

            if(update.texture != null){
                players[moved_player_id].texture = update.texture;
            }
            players[moved_player_id].sprite_rotation = update.sprite_rotation;
            if(update.drawn_shape != null){
                draw_queue.push(update.drawn_shape);
            }
            if(update.audio != null){
                audio_queue.push(update.audio);
            }
        }
    });

    socket.on("hit-enemy", (data) => {
        console.log("Hit enemy with ID " + data.id);
        let hit_enemy = enemies.get(data.id);
        let player_responsible_id = data.player;
        console.log(data);
        console.log("Player " + player_responsible_id + " hit " + hit_enemy);
        if(hit_enemy != undefined){
            //sometimes synchronization issues can occur
            hit_enemy.hp -= data.damage;
            if(hit_enemy.hp <= 0){

                hit_enemy.hp = 0;
                hit_enemy.isAlive = false;
                kills[hit_enemy.name] += 1;
                let enemy_score = hit_enemy.score
                players[player_responsible_id].score += enemy_score;
            }
        }
    });

    socket.on("heal", (amount, player_id, callback) => {
        console.log("Player with ID " + player_id + " healed by " + amount);
        if(players[player_id].hp + amount <= 100){
            players[player_id].hp += amount;
        } else {
            players[player_id].hp = 100;
        }
        callback({
            remaining_hp: players[player_id].hp
        })
    })

    socket.on("take-damage", (damage_amount, player_id, callback) => {
        console.log("Player with ID " + player_id + " took damage " + damage_amount);
        players[player_id].hp -= damage_amount;
        if(players[player_id].hp > 0){
            callback({
                remaining_hp: players[player_id].hp,
                isDead: false
            });
        } else {
            players[player_id].hp = 0
            players[player_id].isDead = true;

            let is_game_over = true;
            players.map((player) => {
                //check how many players are still alive
                if(player != null && !player.isDead){
                    is_game_over = false;
                }
            });

            if(is_game_over){
                GAME_STARTED = false;
                GAME_ENDED = true;
                io.emit("game over", {
                    frontend_host: FRONTEND_HOST,
                    frontend_port: FRONTEND_PORT
                });
            }

            callback({
                remaining_hp: players[player_id].hp,
                isDead: true,
                is_game_over: is_game_over
            });

            
        }
    });

    socket.on("get-frontend-ip", (callback) => {
        callback({
            frontend_ip: FRONTEND_HOST,
            frontend_port: FRONTEND_PORT
        });
    })

    socket.on("game-over", (callback)=> {
        console.log("Game over!!!");
        //communicate with central game server that the game has ended
        GAME_ENDED = true;
        
        fetch("http://" + API_SERVER + ":3050/gameover", {
            method: "POST",
            headers: { "Content-Type": "application/json"},
            body: JSON.stringify(
                {
                    server_name: SERVER_NAME,
                    server_number: SERVER_NUMBER,
                    server_passcode: LOBBY_PASSCODE
                }
            )
        }).then((res) => res.json())
        .then((res) => {
            console.log(res);
        }).then(
            fetch("http://" + API_SERVER + ":3050/frontendIP", {
                method: "GET",
                headers: { "Content-Type": "application/json"},
            }).then((res) => res.json())
            .then((res) => {
                console.log("Output of game-over:")
                let frontend_host = res.data.host;
                let frontend_port = res.data.port;
                io.emit("game over", {
                    frontend_host: frontend_host,
                    frontend_port: frontend_port
                })
                /*
                callback({
                    frontend_host: frontend_host,
                    frontend_port: frontend_port
                });
                */
            })
        )
        .catch((err) => {
            console.log("There was an error");
            console.log(err);
        });
        
    })

    socket.on("disconnect", (reason) => {
        console.log("Socket " + socket.id + " disconnected for reason: " + reason);
        let player_id = null;
        players.map((player) => {
            if(player != null && player.socket_id == socket.id){
                player_id = player.id;
                console.log("The player with ID " + player_id +  " disconnected");
            }
        })
        let player_name = players[player_id].name;

        players[player_id] = null;
        let i = player_id + 1;
                
        if(!GAME_STARTED){
            //only rearrange players if the game has not started yet (we are in the lobby phase)
            //otherwise chaos occurs
            while(i < max_players){
                players[i - 1] = players[i];
                if(players[i - 1] != null){
                    players[i - 1].id = i - 1;
                }
                players[i] = null;
                i += 1;
            }

            console.log(players);
        }

        curr_id -= 1;
        console.log((curr_id + 1) + " users currently connected");

        io.emit("player left", player_id, player_name);
        
        console.log("A player disconnected");
        
        fetch("http://" + API_SERVER + ":3050/server/playerleft", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({
                server_name: "bug-blaster-server1",
                n_players: curr_id,
                player_id: player_id
            })
        }).then((res) => res.json())
        .then((res) => {
            console.log("Acknowledgement of player leaving:");
            console.log(res);
            console.log("Curr id: " + curr_id + " GAME_STARTED: " + GAME_STARTED + " GAME_ENDED: " + GAME_ENDED);
            if(curr_id == 0 && (GAME_ENDED || GAME_STARTED)){
                //if nobody is left in the server, shut down the pod and reconfigure the service
                //don't shut down the server if people are coming in and out of the lobby, only shut it
                //down if they started the game and then abandoned it
                fetch("http://" + API_SERVER + ":3050/gameover", {
                    method: "POST",
                    headers: {"Content-Type": "application/json"},
                    body: JSON.stringify(
                        {
                            server_name: SERVER_NAME,
                            server_number: SERVER_NUMBER,
                            server_passcode: LOBBY_PASSCODE
                        }
                    )
                }).then((res) => {res.json()})
                .then((res) => {
                    console.log(res);
                })
                //no players 
            }

        });
        
    })

});

setInterval(() => {

    let enemy_data = {}
    enemies.forEach((enemy) => {
        if(enemy.isAlive){
            enemy_data[enemy.id] = enemy.calculateMovementData(0);
        } else {
            if(!enemy.last_gasp){
                //the purpose of last_gasp is to notify the client that an enemy has died so that
                //they can clean things up on their end. Once the enemy has transmitted its data
                //for the final time, last_gasp is set to true so that it can "die" for real
                //(it is removed from the enemies Map)
                enemy_data[enemy.id] = enemy.calculateMovementData(0);
                enemy.last_gasp = true;
            } else {
                enemies.delete(enemy.id);
            }
        }
    })

    io.emit("update_positions", {
        positions: players.map(player => getPlayerDataCallbackFunction(player)),
        drawn_shapes: draw_queue,
        audio: audio_queue,
        //enemy_data: bug1.calculateMovementData(0)
        enemy_data: enemy_data
    });
    //empty out the draw queue
    audio_queue = [];
    draw_queue = [];
}, 100);

let SPAWN_TIMER = 10;
let CURRENT_SPAWN_TIMER = 10;


setInterval(() => {
    
    if(GAME_STARTED){
        if(CURRENT_SPAWN_TIMER <= 0){
            

            //let spawn_data = getSpawnsTesting();
            let spawn_data = getSpawnsDemo();
            //let spawn_data = getSpawns();

            let i = 0;

            let spawning_enemies = []

            while(i < spawn_data.spawn_group_size){
                //spawn a group of enemies at once
                let random_enemy_spawn = Math.random() * 100;
                console.log("Generated random number " + random_enemy_spawn)
                
                let new_enemy_name = null;
                let new_enemy = null;

                for(var enemy_name in spawn_data.percentages){
                    if(random_enemy_spawn <= spawn_data.percentages[enemy_name]){
                        new_enemy_name = enemy_name
                        break;
                    }
                }

                let side = Math.random();
                let random_x = 0;
                let random_y = 0;
                if(side <= 0.5){
                    random_x = 800 + (200 * Math.random());
                    random_y = 600 * Math.random();
                } else {
                    random_x = 800 * (Math.random());
                    random_y = 600 + (200 * Math.random());
                }
                
                if(new_enemy_name === "Red Crawler"){
                    new_enemy = new Bug("Red Crawler", random_x, random_y, 30, 30, 10, 6, 10, false);
                    new_enemy.setDropTable(red_crawler_drop_table);                    
                } else if(new_enemy_name === "Blue Crawler") {
                    new_enemy = new Bug("Blue Crawler", random_x, random_y, 50, 50, 15, 6, 15, false);
                    new_enemy.setDropTable(blue_crawler_drop_table);
                } else if(new_enemy_name === "Giant Crawler"){
                    new_enemy = new Bug("Giant Crawler", random_x, random_y, 100, 100, 19, 6, 30, false);
                    new_enemy.setDropTable(giant_crawler_drop_table);
                } else if (new_enemy_name === "Jewel Spider") {
                    new_enemy = new Bug("Jewel Spider", random_x, random_y, 120, 120, 15, 6, 40, false);
                    new_enemy.setDropTable(jewel_spider_drop_table);
                } else if (new_enemy_name === "Acid Spitter"){
                    new_enemy = new Bug("Acid Spitter", random_x, random_y, 80, 80, 10, 6, 50, false);
                    new_enemy.setDropTable(acid_spitter_drop_table)
                } else {
                    console.log("WARNING: UNRECOGNIZED ENEMY NAME");
                    new_enemy = new Bug("Red Crawler", random_x, random_y, 30, 30, 10, 6, 10, false);
                    new_enemy.setDropTable(red_crawler_drop_table);
                }
                
                console.log("Spawning enemy with ID " + new_enemy.id);
                enemies.set(new_enemy.id, new_enemy);

                spawning_enemies.push(new_enemy);
                //spawn a new enemy
                i += 1;
            }

            io.emit("spawn_enemy", {
                enemies: spawning_enemies,
                wave_number: WAVE_NUMBER,
                wave_interval: spawn_data.spawn_group_frequency
            });

            WAVE_NUMBER += 1;
            CURRENT_SPAWN_TIMER = spawn_data.spawn_group_frequency

        } else {
            CURRENT_SPAWN_TIMER -= 1;
            io.emit("decrease_spawn_timer", {
                spawn_timer: CURRENT_SPAWN_TIMER
            })
        }
        
    }
}, 1000)


server.listen(3100, () => {
    console.log('listening on port *:3100');
    if("SERVER_NAME" in process.env){
        SERVER_NAME = process.env.SERVER_NAME;
        SERVER_NUMBER = parseInt(process.env.SERVER_NUMBER);
        API_SERVER = "bug-blaster-frontend-api-server-service";
        //LOBBY_PASSCODE = process.env.LOBBY_PASSCODE;
    } else {
        SERVER_NAME = "bug-blaster-server1";
        SERVER_NUMBER = 1;
        API_SERVER = "localhost";
    }
    console.log("API SERVER NAME: " + API_SERVER);
    fetch("http://" + API_SERVER + ":3050/server/getPasscode", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            server_number: SERVER_NUMBER
        })
    }).then((res) => res.json())
    .then((res) => {
        if(res.status == "success"){
            console.log("Successfully fetched lobby passcode");
            LOBBY_PASSCODE = res.data;
        } else {
            console.log("Failed to fetch lobby passcode");
            LOBBY_PASSCODE = "defaultpassword"
        }
    });

    fetch("http://" + API_SERVER + ":3050/frontendIP", {
        method: "GET",
        headers: {"Content-Type": "application/json"},
    }).then((res) => res.json())
    .then((res) => {
        console.log(res);
        if(res.status === "success"){
            console.log("Successfully fetched frontend host and port");
            FRONTEND_HOST = res.data.host;
            FRONTEND_PORT = res.data.port;
            console.log("FRONTEND HOST: " + FRONTEND_HOST);
            console.log("FRONTEND PORT: " + FRONTEND_PORT);
        }
    })
    
});