import { BanchoClient, BanchoLobby, BanchoMod, BanchoMods, BanchoMultiplayerChannel } from "bancho.js";
import { Client, Mode } from "nodesu";
import { config } from "./config.json";
import { match } from "./match.json";
const api = new Client(config.apiKey);
const bancho = new BanchoClient(config);
let channel: BanchoMultiplayerChannel;
let lobby: BanchoLobby;
let mappool: Mappool;
let scoreRed: number;
let scoreBlue: number;
let bestOf: number;
let pickindex = 0;
let counts: number[] = [];
let pickorder: number[] = [];
interface Mappool {
  name: string;
  modgroups: Modgroup[];
}

interface Modgroup {
    mod: string;
    maps: string[];
}

async function getPool(pool: string) {
    try {
        const data = await import('./pools/' + pool + '.json') as Mappool;
        mappool = data;
    } catch (err) {
        console.log(err);
    }
    for (let i = 0; i < mappool.modgroups.length - 1; i++) {
        counts.push(mappool.modgroups[i].maps.length);
    }
    while (pickorder.length < match.bestOf) {
        let set: number[] = [];
        for (let i = 0; i < counts.length; i++) {
            if (counts[i] > 0) {
                counts[i]--;
                set.push(i);
            }
        }
        for (let i = set.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [set[i], set[j]] = [set[j], set[i]];
        }
        pickorder = pickorder.concat(set);
    }
}

async function init() {
    try {
        await bancho.connect();
        channel = await bancho.createLobby("sawadatest");
    } catch (err) {
        console.log(err);
        console.log("failed to create lobby");
    }
    lobby = channel.lobby;
    await getPool('906bcbf4-6675-3d23-b888-eff53539a19b');
    await setRandomBeatmap();
    await lobby.setPassword("test");
    await lobby.invitePlayer("monko2k");
    eventHandle();
    
}

function eventHandle() {
    lobby.on("allPlayersReady", async () => {
        await setRandomBeatmap();
    })
}

async function setRandomBeatmap() {
    const modgroupindex = pickorder[pickindex];
    const modgroup = mappool.modgroups[modgroupindex];
    const mapindex = Math.floor(Math.random() * modgroup.maps.length);
    const map = Number(modgroup.maps[mapindex]);
    let mods: BanchoMod[];
    let freemod = false;
    // no idea why modstring doesn't work Lol
    switch(modgroup.mod) {
        case "NM":
            mods = [BanchoMods.NoFail];
            break;
        case "HD":
            mods = [BanchoMods.Hidden, BanchoMods.NoFail];
            break;
        case "HR": 
            mods = [BanchoMods.HardRock, BanchoMods.NoFail];
            break;
        case "DT": 
            mods = [BanchoMods.DoubleTime, BanchoMods.NoFail];
            break;
        case "FM":
        case "TB":
            mods = [BanchoMods.None]
            freemod = true;
            break;
    }
    await lobby.setMap(map, Mode.osu);
    await lobby.setMods(mods!, freemod);
    mappool.modgroups[modgroupindex].maps.splice(mapindex, 1);
    pickindex++;
}
init();