import { BanchoClient, BanchoLobby, BanchoMod, BanchoMods, BanchoMultiplayerChannel,  BanchoLobbyTeamModes, BanchoLobbyWinConditions } from "bancho.js";
import { Client, Mode } from "nodesu";
import { config } from "./config.json";
import { match } from "./match.json";
const api = new Client(config.apiKey);
const bancho = new BanchoClient(config);
let channel: BanchoMultiplayerChannel;
let lobby: BanchoLobby;
let mappool: Mappool;
let pickindex = 0;
let pointsRed = 0;
let pointsBlue = 0;
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
    lobby.setSettings(BanchoLobbyTeamModes.TeamVs, BanchoLobbyWinConditions.ScoreV2, match.teamSize * 2);
    await getPool('906bcbf4-6675-3d23-b888-eff53539a19b');
    await setRandomBeatmap();
    await lobby.setPassword("test");
    await lobby.invitePlayer("monko2k");
    eventHandle();
    
}

function eventHandle() {
    lobby.on("allPlayersReady", async () => {
        await lobby.startMatch();
    }),

    lobby.on("matchFinished", async () => {
        let scoreRed = 0;
        let scoreBlue = 0;
        const scores = lobby.scores;
        for (let i = 0; i < scores.length; i++) {
            if (scores[i].player.team === 'Red') {
                scoreRed += scores[i].score;
            } else {
                scoreBlue += scores[i].score;
            }
        }
        const diff = Math.abs(scoreRed - scoreBlue);
        if (scoreRed > scoreBlue) {
            channel.sendMessage(`Red wins by ${diff}`)
            pointsRed++;
        } else if (scoreBlue > scoreRed) {
            channel.sendMessage(`Blue wins by ${diff}`)
            pointsBlue++;
        } else {
            channel.sendMessage("Tied scores: Neither team earns a point");
        }
        sendScore();
        if ( pointsRed === Math.ceil(match.bestOf/2)) {
            channel.sendMessage("Red wins the match");
            endMatch();
        } else if ( pointsBlue ===  Math.ceil(match.bestOf/2)) {
            channel.sendMessage("Blue wins the match");
            endMatch();
        } else if ( pointsRed === pointsBlue && pointsBlue === Math.floor(match.bestOf/2)) {
            channel.sendMessage("Scores are tied. A tiebreaker will be played")
            await setTieBreaker();
        } else {
            await setRandomBeatmap();
        }

    })
}

async function setTieBreaker() {
    const modgroupindex = mappool.modgroups.length - 1;
    const modgroup = mappool.modgroups[modgroupindex];
    const mapindex = Math.floor(Math.random() * modgroup.maps.length);
    const map = Number(modgroup.maps[mapindex]);
    await lobby.setMap(map, Mode.osu);
    await lobby.setMods([BanchoMods.None], true);
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
function sendScore() {
    channel.sendMessage(`[Red] ${pointsRed} : ${pointsBlue} [Blue]`);
}
async function endMatch() {
    channel.sendMessage(`Final score: [Red] ${pointsRed} : ${pointsBlue} [Blue]`);
    channel.sendMessage("Lobby will automatically close in 30 seconds");
    await new Promise(r => setTimeout(r, 30000));
    await lobby.closeLobby();
}
init();