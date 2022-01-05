import { BanchoClient, BanchoLobby, BanchoMod, BanchoMods, BanchoMultiplayerChannel,  BanchoLobbyTeamModes, BanchoLobbyWinConditions, BanchoLobbyPlayer, ChannelMessage } from 'bancho.js';
import { Client, Mode } from 'nodesu';
import { Channel, Client as DiscordClient, Intents, Interaction, Message, MessageCollector, MessageEmbed, PresenceManager } from 'discord.js';
import { config } from './config.json';
const api = new Client(config.apiKey);
const bancho = new BanchoClient(config);
const discordclient = new DiscordClient({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES] });
let lobbies: BanchoLobby[] = [];

interface Mappool {
  name: string;
  modgroups: Modgroup[];
}

interface Modgroup {
    mod: string;
    maps: string[];
}

interface MatchInfo {
    pool: string;
    bestOf: number;
    teamSize: number;
    red: string[];
    blue: string[];
}

interface Game {
    channel?: BanchoMultiplayerChannel;
    lobby?: BanchoLobby;
    mappool?: Mappool;
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
            lobbies[i].closeLobby();
        }
        await bancho.disconnect();
        process.exit();
    })
}

async function handleMessage(m: Message) {
    if (m.author.id === discordclient.user?.id || m.author.bot)
        return;

    const prefix = '?';
    if (m.content === `${prefix}startmatch`) {
        let pool: string;
        let bestOf: number;
        let teamSize: number;
        let red: string[];
        let blue: string[];
        m.reply('Enter team size (1-8)')
            .then(async () => {
                teamSize = Number(await awaitResponse(m));
                if (teamSize < 1 || teamSize > 8) {
                    m.channel.send('Invalid teamsize');
                    throw 'Input Error';
                }
            })
            .then(async () => {
                m.reply('Enter BestOf (1-13)')
                bestOf = Number(await awaitResponse(m));
                if (bestOf < 1 || bestOf > 13 || !Number.isInteger(bestOf) || bestOf%2 !== 1) {
                    m.channel.send('Invalid BestOf');
                    throw 'Input Error';
                }
            })
            .then(async () => {
                m.reply('Enter Team 1 members (comma separated)')
                red = (await awaitResponse(m)).split(',');
                console.log(red.length)
                if (red.length !== teamSize) {
                    m.channel.send('Invalid number of members');
                    throw 'Input Error';
                }
                red = red.map((e) => {
                    return e.trim();
                })
            })
            .then(async () => {
                m.reply('Enter Team 2 members (comma separated)')
                blue = (await awaitResponse(m)).split(',');
                if (blue.length !== teamSize) {
                    m.channel.send('Invalid number of members');
                    throw 'Input Error';
                }
                blue = blue.map((e) => {
                    return e.trim();
                })
            })
            .then(async () => {
                m.reply('Enter Mappool')
                pool = await awaitResponse(m);
            })
            .then(() => {
                const match: MatchInfo = {
                    pool: pool,
                    bestOf: bestOf,
                    teamSize: teamSize,
                    red: red,
                    blue: blue,
                }
                const embed = new MessageEmbed()
                    .setColor('#FFFFFF')
                    .setTitle('Sawada Scrim Match')
                    .setDescription(`BO${bestOf} ${teamSize}v${teamSize}`)
                    .addFields(
                        { name: 'Mappool', value: pool.toString() },
                        { name: '\u200B', value: '\u200B' },
                        { name: 'Team 1', value: red.toString() },
                        { name: 'Team 2', value: blue.toString() },
                    )
                    .setTimestamp();
                m.channel.send({ embeds: [embed]});
                initGame(match);
            })
            .catch((err) => {
                //catch user errors, but don't do anything with them for now 
            })
        

    }
}


async function awaitResponse(m: Message): Promise<string> {
    const filter = (response: Message) => {
        return (response.author.id === m.author.id)
    }
    return new Promise<string>((resolve) => {
        m.channel.awaitMessages({ filter, max: 1, time: 30000, errors: ['time'] })
            .then(collected => {
                resolve(collected.first()!.content)
            }).catch(() => {
                m.channel.send('Setup timed out');
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
    return new Promise<Mappool>(async (resolve) => {
        try {
            const data = await import('./pools/' + pool + '.json') as Mappool;
            resolve(data);
        } catch (err) {
            console.log(err);
        }
    })
}

async function initGame(match: MatchInfo) {
    let game: Game = {
        pickindex: 1,
        pointsRed: 0,
        pointsBlue: 0,
        pickorder: [],
        redPlayers: match.red,
        bluePlayers: match.blue,
        bestOf: match.bestOf,
    }
    game.mappool = await getPool(match.pool);
    game.pickorder = setOrder(game.mappool, game.bestOf);
    try {
        if (bancho.isDisconnected())
            await bancho.connect();
        game.channel = await bancho.createLobby('sawadatest');
    } catch (err) {
        console.log(err);
        console.log('failed to create lobby');
        return
    }
    game.lobby = game.channel.lobby;
    game.lobby.setSettings(BanchoLobbyTeamModes.TeamVs, BanchoLobbyWinConditions.ScoreV2, match.teamSize * 2);
    lobbies.push(game.lobby);
    await setRandomBeatmap(game.lobby, game.mappool, game.pickorder[0]);
    await game.lobby.setPassword(Math.random().toString(36));
    const players = game.redPlayers.concat(game.bluePlayers);
    console.log(players)
    for (const player of players) {
        await game.lobby.invitePlayer(player);
    }
    game.lobby.invitePlayer('Monko2k');
    eventHandle(game);
}

function eventHandle(game: Game) {
    const lobby = game.lobby!;
    const channel = game.channel!;
    lobby.on('allPlayersReady', async () => {
        await lobby.startMatch(10);
    });

    lobby.on('matchFinished', async () => {
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
            game.pointsRed++;
        } else if (scoreBlue > scoreRed) {
            channel.sendMessage(`Blue wins by ${diff}`)
            game.pointsBlue++;
        } else {
            channel.sendMessage('Tied scores: Neither team earns a point');
        }
        sendScore();
        if ( game.pointsRed === Math.ceil(game.bestOf/2)) {
            channel.sendMessage('Red wins the match');
            endMatch();
        } else if ( game.pointsBlue ===  Math.ceil(game.bestOf/2)) {
            channel.sendMessage('Blue wins the match');
            endMatch();
        } else if ( game.pointsRed === game.pointsBlue && game.pointsBlue === Math.floor(game.bestOf/2)) {
            channel.sendMessage('Scores are tied. A tiebreaker will be played')
            await setTieBreaker();
        } else {
            game.pickindex++
            await setRandomBeatmap(game.lobby!, game.mappool!, game.pickorder[game.pickindex]);
        }
    });

    lobby.on('playerJoined', async (res) => {
        await setTeam(res.player);
    });

    lobby.on('playerChangedTeam', async (res) => {
        await setTeam(res.player);
    });

    function sendScore() {
        channel.sendMessage(`[Red] ${game.pointsRed} : ${game.pointsBlue} [Blue]`);
    };
    async function endMatch() {
        channel.sendMessage(`Final score: [Red] ${game.pointsRed} : ${game.pointsBlue} [Blue]`);
        channel.sendMessage('Lobby will automatically close in 30 seconds');
        await new Promise(r => setTimeout(r, 30000));
        await lobby.closeLobby();
        // I think this can fail if two lobbies end at exactly the same time
        // this bot isn't designed to be used by a lot of people at once so I will assume that this is ok for now lol
        const index = lobbies.indexOf(lobby);
        lobbies.splice(index, 1);
    };
    async function setTeam(player: BanchoLobbyPlayer) {
        if (game.redPlayers.includes(player.user.username)) {
            await lobby.changeTeam(player, 'Red')
        }
        if (game.bluePlayers.includes(player.user.username)) {
            await lobby.changeTeam(player, 'Blue')
        }
    }
    async function setTieBreaker() {
        const modgroupindex = game.mappool!.modgroups.length - 1;
        const modgroup = game.mappool!.modgroups[modgroupindex];
        const mapindex = Math.floor(Math.random() * modgroup.maps.length);
        const map = Number(modgroup.maps[mapindex]);
        await lobby.setMap(map, Mode.osu);
        await lobby.setMods([BanchoMods.None], true);
    }

}

async function setRandomBeatmap(lobby: BanchoLobby, mappool: Mappool, modgroupindex: number) {
    const modgroup = mappool.modgroups[modgroupindex];
    const mapindex = Math.floor(Math.random() * modgroup.maps.length);
    const map = Number(modgroup.maps[mapindex]);
    let mods: BanchoMod[];
    let freemod = false;
    // no idea why modstring doesn't work Lol
    switch(modgroup.mod) {
        case 'NM':
            mods = [BanchoMods.NoFail];
            break;
        case 'HD':
            mods = [BanchoMods.Hidden, BanchoMods.NoFail];
            break;
        case 'HR': 
            mods = [BanchoMods.HardRock, BanchoMods.NoFail];
            break;
        case 'DT': 
            mods = [BanchoMods.DoubleTime, BanchoMods.NoFail];
            break;
        case 'FM':
        case 'TB':
            mods = [BanchoMods.None]
            freemod = true;
            break;
    }
    await lobby.setMap(map, Mode.osu);
    await lobby.setMods(mods!, freemod);
    mappool.modgroups[modgroupindex].maps.splice(mapindex, 1);
}

initDiscord();