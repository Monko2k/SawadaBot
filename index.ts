import * as bancho from 'bancho.js';
import { Client, Mode, Mods } from 'nodesu';
import { Channel, Client as DiscordClient, Intents, Interaction, Message, MessageCollector, MessageEmbed, PresenceManager, TextChannel } from 'discord.js';
import { config } from './config.json';
import * as crypto from 'crypto';
const api = new Client(config.apiKey);
const banchoclient = new bancho.BanchoClient(config);
const discordclient = new DiscordClient({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES] });
let lobbies: bancho.BanchoLobby[] = [];

interface Mappool {
  name: string;
  modgroups: Modgroup[];
}

interface Modgroup {
    mod: string;
    maps: string[];
}

interface MatchInfo {
    matchcode: string;
    mappool: Mappool;
    bestOf: number;
    teamSize: number;
    red: string[];
    blue: string[];
    discordchannel: TextChannel;
}

interface Game {
    channel?: bancho.BanchoMultiplayerChannel;
    mappool: Mappool;
    pickindex: number;
    pointsRed: number;
    pointsBlue: number;
    pickorder: number[];
    redPlayers: string[];
    bluePlayers: string[];
    bestOf: number;
}



function initDiscord() {
    discordclient.on('messageCreate', handleMessage);
    try {
        discordclient.login(config.token);
    } catch (err) {
        console.log(err);
        return;
    }
    console.log('Initialized Discord Client');
    process.on('SIGINT', async () => {
        for (let i = 0; i < lobbies.length; i++) {
            await lobbies[i].closeLobby();
        }
        await banchoclient.disconnect();
        process.exit();
    })
}

async function handleMessage(m: Message) {
    if (m.author.id === discordclient.user?.id || m.author.bot)
        return;

    const prefix = '?';
    if (m.content === `${prefix}startmatch`) {
        let bestOf: number;
        let teamSize: number;
        let red: string[];
        let blue: string[];
        m.reply('Enter team size (1-8)')
            .then(async () => {
                teamSize = Number(await awaitResponse(m));
                if (Number.isNaN(teamSize) || teamSize < 1 || teamSize > 8) {
                    throw 'Invalid team size';
                }
            })
            .then(async () => {
                m.reply('Enter BestOf (1-13)')
                bestOf = Number(await awaitResponse(m));
                if (bestOf < 1 || bestOf > 13 || !Number.isInteger(bestOf) || bestOf%2 !== 1) {
                    throw 'Invalid bestOf';
                }
            })
            .then(async () => {
                m.reply('Enter Team 1 members (comma separated)')
                red = (await awaitResponse(m)).split(',');
                if (red.length !== teamSize) {
                    throw 'Invalid number of members';
                }
                red = red.map((e) => e.trim())
            })
            .then(async () => {
                m.reply('Enter Team 2 members (comma separated)')
                blue = (await awaitResponse(m)).split(',');
                if (blue.length !== teamSize) {
                    throw 'Invalid number of members';
                }
                blue = blue.map((e) => e.trim())
            })
            .then(async () => {
                m.reply('Enter Mappool (https://oma.hwc.hr/pools, 2800+ elo pools)')
                let poolid = await awaitResponse(m);
                const re = /[^//]+$/;
                if (re.test(poolid)) {
                    const mappool = await getPool(poolid.match(re)![0]);
                    if (mappool) {
                        return mappool
                    } else {
                        throw 'Invalid mappool'
                    }
                } else {
                    throw 'Invalid mappool URL format'
                }
            })
            .then((res) => {
                const match: MatchInfo = {
                    matchcode: crypto.randomBytes(3).toString('hex').toUpperCase(),
                    mappool: res,
                    bestOf: bestOf,
                    teamSize: teamSize,
                    red: red,
                    blue: blue,
                    discordchannel: m.channel as TextChannel,
                }
                initGame(match);
            })
            .catch((err) => {
                m.channel.send(err);
            })
        

    }
}

async function awaitResponse(m: Message): Promise<string> {
    const filter = (response: Message) => (response.author.id === m.author.id)
    return new Promise<string>((resolve, reject) => {
        m.channel.awaitMessages({ filter, max: 1, time: 30000, errors: ['time'] })
            .then(collected => {
                resolve(collected.first()!.content)
            }).catch(() => {
                reject('Setup timed out');
            })
    }) 
}

function setOrder(mappool: Mappool, bestOf: number): Array<number> {
    let counts: number[] = [];
    let pickorder: number[] = [];
    for (let i = 0; i < mappool.modgroups.length - 1; i++) {
        counts.push(mappool.modgroups[i].maps.length);
    }
    while (pickorder.length < bestOf) {
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
    return pickorder;

}

async function getPool(pool: string): Promise<Mappool> {
    return new Promise<Mappool>(async (resolve, reject) => {
        try {
            const data = await import('./pools/' + pool + '.json') as Mappool;
            resolve(data);
        } catch (err) {
            reject('Invalid Pool');
        }
    })
}

async function initGame(match: MatchInfo) {
    let game: Game = {
        mappool: match.mappool,
        pickindex: 1,
        pointsRed: 0,
        pointsBlue: 0,
        pickorder: [],
        redPlayers: match.red,
        bluePlayers: match.blue,
        bestOf: match.bestOf,
    }
    const embed = new MessageEmbed()
        .setColor(`#${match.matchcode}`)
        .setTitle(`Sawada Scrim Match #${match.matchcode}`)
        .setDescription(`BO${match.bestOf} ${match.teamSize}v${match.teamSize}`)
        .addFields(
            { name: 'Mappool', value: match.mappool.name },
            { name: 'Team 1', value: match.red.join(', ') },
            { name: 'Team 2', value: match.blue.join(', ') },
        )
        .setTimestamp();
    match.discordchannel.send({ embeds: [embed]});
    game.pickorder = setOrder(game.mappool, game.bestOf);
    try {
        if (banchoclient.isDisconnected())
            await banchoclient.connect();
        game.channel = await banchoclient.createLobby(`Sawada Scrim #${match.matchcode}`);
    } catch (err) {
        console.log('failed to create lobby:', err);
        return
    }
    const lobby = game.channel.lobby;
    lobby.setSettings(bancho.BanchoLobbyTeamModes.TeamVs, bancho.BanchoLobbyWinConditions.ScoreV2, match.teamSize * 2);
    lobby.updateSettings();
    lobbies.push(lobby);
    await setRandomBeatmap(game.channel, game.mappool, game.pickorder[0]);
    //TODO: lock the slots and teams
    await lobby.setPassword(crypto.randomBytes(10).toString('hex'));
    const players = game.redPlayers.concat(game.bluePlayers);
    for (const player of players) {
        await lobby.invitePlayer(player);
    }
    lobby.invitePlayer('Monko2k');
    eventHandle(game);
}

function eventHandle(game: Game) {
    const tie = (game.bestOf > 1 && game.pointsRed === game.pointsBlue && game.pointsBlue === Math.floor(game.bestOf/2));
    const winpoints = Math.ceil(game.bestOf/2);
    const channel = game.channel!
    const lobby = channel.lobby;
    lobby.on('allPlayersReady', async () => {
        console.log(lobby.slots)
        //TODO: check that the lobby is full
        //not sure what to do for if the players want the match to continue while missing a player
        await lobby.startMatch(10);
    });
    lobby.on("playing", () => console.log(lobby.slots))

    lobby.on("mods", () => console.log('poon'))

    lobby.on('matchFinished', async () => {
        let scoreRed = 0;
        let scoreBlue = 0;
        const scores = lobby.scores;
        //TODO: Add NM debuff for FM
        console.log(scores);
        for (let i = 0; i < scores.length; i++) {
            if (scores[i].pass) {
                let score = scores[i].score;
                if (lobby.freemod && !tie) {
                    console.log(scores[i].player.mods.length)
                    // player mods doesn't work 
                }
                (scores[i].player.team === 'Red') ? scoreRed += score : scoreBlue += score;
            }
        }
        const diff = Math.abs(scoreRed - scoreBlue);
        if (scoreRed > scoreBlue) {
            channel.sendMessage(`Red wins by ${diff}`)
            game.pointsRed++;
        } else if (scoreBlue > scoreRed) {
            channel.sendMessage(`Blue wins by ${diff}`)
            game.pointsBlue++;
        } else {
            channel.sendMessage('Tied scores: Neither team earns a point');
        }
        sendScore();
        if (game.pointsRed === winpoints) {
            channel.sendMessage('Red wins the match');
            endMatch();
        } else if (game.pointsBlue === winpoints) {
            channel.sendMessage('Blue wins the match');
            endMatch();
        } else if (tie) {
            channel.sendMessage('Scores are tied. A tiebreaker will be played')
            await setTieBreaker();
        } else {
            game.pickindex++
            await setRandomBeatmap(game.channel!, game.mappool, game.pickorder[game.pickindex]);
        }
    });

    lobby.on('playerJoined', async (res) => {
        await setTeam(res.player);
    });

    lobby.on('playerChangedTeam', async (res) => {
        await setTeam(res.player);
    });

    function sendScore() {
        channel.sendMessage(`Current Score: Red ${game.pointsRed} : ${game.pointsBlue} Blue`);
    };
    async function endMatch() {
        channel.sendMessage(`Final score: Red ${game.pointsRed} : ${game.pointsBlue} Blue`);
        channel.sendMessage('Lobby will automatically close in 30 seconds');
        await new Promise(r => setTimeout(r, 30000));
        await lobby.closeLobby();
        // I think this can fail if two lobbies end at exactly the same time
        // this bot isn't designed to be used by a lot of people at once so I will assume that this is ok for now lol
        lobbies.splice(lobbies.indexOf(lobby), 1);
    };
    async function setTeam(player: bancho.BanchoLobbyPlayer) {
        if (game.redPlayers.includes(player.user.username)) {
            await lobby.changeTeam(player, 'Red')
        }
        if (game.bluePlayers.includes(player.user.username)) {
            await lobby.changeTeam(player, 'Blue')
        }
    }
    async function setTieBreaker() {
        const modgroup = game.mappool.modgroups.at(-1)!;
        const mapindex = Math.floor(Math.random() * modgroup.maps.length);
        const map = Number(modgroup.maps[mapindex]);
        await lobby.setMap(map, Mode.osu);
        await lobby.setMods([bancho.BanchoMods.None], true);
    }

}

async function setRandomBeatmap(channel: bancho.BanchoMultiplayerChannel, mappool: Mappool, modgroupindex: number) {
    const lobby = channel.lobby;
    const modgroup = mappool.modgroups[modgroupindex];
    let mapindex = Math.floor(Math.random() * modgroup.maps.length);
    while (modgroup.maps[mapindex] === '0') {
        mapindex = Math.floor(Math.random() * modgroup.maps.length);
        console.log('roll')
    }
    const map = Number(modgroup.maps[mapindex]);
    mappool.modgroups[modgroupindex].maps[mapindex] = '0';
    let mods: bancho.BanchoMod[];
    let freemod = false;
    // no idea why modstring doesn't work Lol
    switch(modgroup.mod) {
        case 'NM':
            mods = [bancho.BanchoMods.NoFail];
            break;
        case 'HD':
            mods = [bancho.BanchoMods.Hidden, bancho.BanchoMods.NoFail];
            break;
        case 'HR': 
            mods = [bancho.BanchoMods.HardRock, bancho.BanchoMods.NoFail];
            break;
        case 'DT': 
            mods = [bancho.BanchoMods.DoubleTime, bancho.BanchoMods.NoFail];
            break;
        case 'FM':
        case 'TB':
            mods = [bancho.BanchoMods.None]
            freemod = true;
            break;
    }
    channel.sendMessage(`Next Map: ${modgroup.mod}${mapindex + 1}`)
    if (freemod)
        channel.sendMessage('Allowed Mods: HD, HR, EZ, FL, NF, NM (0.7x multiplier)')
    await lobby.setMap(map, Mode.osu);
    await lobby.setMods(mods!, freemod);
}

initDiscord();