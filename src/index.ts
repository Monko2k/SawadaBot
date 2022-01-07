import { Client, User } from "nodesu";
import {
    Client as DiscordClient,
    Intents,
    Message,
    MessageEmbed,
    MessageReaction,
    User as DiscordUser,
} from "discord.js";
import { config } from "./config/config.json";
import * as crypto from "crypto";
import { BanchoClient, BanchoLobby } from "bancho.js";
import { MatchInfo } from "./definitions/Match";
import { Mappool } from "./definitions/Mappool";
import { Game } from "./classes/Game";
const api = new Client(config.apiKey);
const banchoclient = new BanchoClient(config);
const discordclient = new DiscordClient({
    intents: [
        Intents.FLAGS.GUILDS,
        Intents.FLAGS.GUILD_MESSAGES,
        Intents.FLAGS.GUILD_MESSAGE_REACTIONS,
    ],
});
const prefix = config.prefix;
let lobbies: BanchoLobby[] = [];

function initDiscord() {
    discordclient.on("messageCreate", handleMessage);
    try {
        discordclient.login(config.token);
    } catch (err) {
        console.log(err);
        return;
    }
    console.log("Initialized Discord Client");
    process.on("exit", () => {
        //this doesn't work
        //TODO: get rid of the entire lobby list structure
        console.log("Closing lobbies...");
        for (let i = 0; i < lobbies.length; i++) {
            lobbies[i].closeLobby();
        }
        console.log("All lobbies closed");
        banchoclient.disconnect();
    });
}

async function handleMessage(m: Message) {
    if (m.author.id === discordclient.user?.id || m.author.bot) return;

    if (m.content === `${prefix}startmatch`) {
        let bestOf: number;
        let teamSize: number;
        let red: User[];
        let blue: User[];
        let all: string[] = [];
        // TODO: move each setup step to its own function so that we can
        // use choose which setup steps to use in alternate gamemodes
        m.reply("Enter team size (1-8)")
            .then(async () => {
                teamSize = Number(await awaitResponse(m));
                if (Number.isNaN(teamSize) || teamSize < 1 || teamSize > 8) {
                    throw "Invalid team size";
                }
            })
            .then(async () => {
                m.reply("Enter BestOf (1-13)");
                bestOf = Number(await awaitResponse(m));
                if (
                    bestOf < 1 ||
                    bestOf > 13 ||
                    !Number.isInteger(bestOf) ||
                    bestOf % 2 !== 1
                ) {
                    throw "Invalid bestOf";
                }
            })
            .then(async () => {
                m.reply("Enter Team 1 members (comma separated)");
                let redNames = (await awaitResponse(m)).split(",");
                if (redNames.length !== teamSize) {
                    throw "Invalid number of members";
                }
                redNames = redNames.map((e) => e.trim());
                red = await validateMembers(redNames, all);
            })
            .then(async () => {
                m.reply("Enter Team 2 members (comma separated)");
                let blueNames = (await awaitResponse(m)).split(",");
                if (blueNames.length !== teamSize) {
                    throw "Invalid number of members";
                }
                blueNames = blueNames.map((e) => e.trim());
                blue = await validateMembers(blueNames, all);
            })
            .then(async () => {
                m.reply(
                    "Enter Mappool (https://oma.hwc.hr/pools, 2800+ elo pools)"
                );
                let poolid = await awaitResponse(m);
                const re = /[^//]+$/;
                if (re.test(poolid)) {
                    const mappool = await getPool(poolid.match(re)![0]);
                    if (mappool) {
                        return mappool;
                    } else {
                        throw "Invalid mappool";
                    }
                } else {
                    throw "Invalid mappool URL format";
                }
            })
            .then(async (res) => {
                const match: MatchInfo = {
                    matchcode: crypto
                        .randomBytes(3)
                        .toString("hex")
                        .toUpperCase(),
                    mappool: res,
                    bestOf: bestOf,
                    teamSize: teamSize,
                    redPlayers: red,
                    bluePlayers: blue,
                    allPlayers: all,
                    initmsg: m,
                };
                const game = await initGame(match);
                lobbies.push(game.channel.lobby);
            })
            .catch((err) => {
                m.channel.send(err);
            });
    }
}

async function awaitResponse(m: Message): Promise<string> {
    const filter = (response: Message) => response.author.id === m.author.id;
    return new Promise<string>((resolve, reject) => {
        m.channel
            .awaitMessages({ filter, max: 1, time: 45000, errors: ["time"] })
            .then((collected) => {
                resolve(collected.first()!.content);
            })
            .catch(() => {
                reject("Setup timed out");
            });
    });
}

async function awaitConfirmReact(m: Message, u: DiscordUser): Promise<string> {
    // this function does not need to exist
    const filter = (reaction: MessageReaction, user: DiscordUser) =>
        user.id === u.id &&
        (reaction.emoji.name === "✅" || reaction.emoji.name == "❌");
    return new Promise<string>((resolve, reject) => {
        m.awaitReactions({ filter, max: 1, time: 15000, errors: ["time"] })
            .then((collected) => {
                resolve(collected.first()?.emoji.name!);
            })
            .catch(() => {
                reject("Confirmation timed out");
            });
    });
}

async function getPool(pool: string): Promise<Mappool> {
    // TODO: put the pools in a nosql db and query, instead of this shit
    return new Promise<Mappool>(async (resolve, reject) => {
        try {
            const data = (await import(
                "../pools/" + pool + ".json"
            )) as Mappool;
            resolve(data);
        } catch (err) {
            reject("Invalid Pool");
        }
    });
}

async function validateMembers(
    members: string[],
    allplayers: string[]
): Promise<Array<User>> {
    return new Promise<Array<User>>(async (resolve, reject) => {
        let users: User[] = [];
        for (let i = 0; i < members.length; i++) {
            const data = await api.user.get(members[i]);
            if (typeof data === "undefined") {
                reject(`Couldn't find user ${members[i]}`);
                return;
            }
            const player = new User(data); // what the hellll
            if (allplayers.includes(player.userId.toString())) {
                reject(
                    `Player ${player.username} cannot be included multiple times`
                );
                return;
            }
            users.push(player);
            allplayers.push(player.userId.toString());
        }
        resolve(users);
    });
}

async function initGame(match: MatchInfo): Promise<Game> {
    return new Promise<Game>(async (resolve, reject) => {
        let embed = new MessageEmbed()
            .setColor("#FFFFFF")
            .setTitle(`Sawada Scrim Match #${match.matchcode}`)
            .setDescription(
                `BO${match.bestOf} ${match.teamSize}v${match.teamSize}`
            )
            .addFields(
                { name: "Mappool", value: match.mappool.name },
                {
                    name: "Team 1",
                    value: match.redPlayers.map((e) => e.username).join(", "),
                },
                {
                    name: "Team 2",
                    value: match.bluePlayers.map((e) => e.username).join(", "),
                }
            )
            .setTimestamp()
            .setFooter("Confirm match settings to start the lobby");
        const confirm = await match.initmsg.channel.send({ embeds: [embed] });
        await confirm.react("✅");
        await confirm.react("❌");
        const gamechannel = await awaitConfirmReact(
            confirm,
            match.initmsg.author
        )
            .then(async (res) => {
                //await confirm.reactions.removeAll(); need perms
                if (res !== "✅") {
                    embed.setColor("#FF0000");
                    throw "Match Cancelled";
                } else {
                    embed.setColor("#72F795");
                    embed.setFooter("Match confirmed, creating lobby...");
                }
            })
            .then(async () => await confirm.edit({ embeds: [embed] }))
            .then(async () => {
                if (banchoclient.isDisconnected()) await banchoclient.connect();
                const channel = await banchoclient.createLobby(
                    `Sawada Scrim #${match.matchcode}`
                );
                embed.setColor("#51E8FE");
                embed.setURL(
                    `https://osu.ppy.sh/community/matches/${channel.lobby.id}`
                );
                embed.setFooter("Match lobby has been created");
                return channel;
            })
            .catch(async (err) => {
                embed.setFooter(`❌ ${err}`);
                reject(err);
                throw err;
            })
            .finally(async () => {
                await confirm.edit({ embeds: [embed] });
            });

        await confirm.edit({ embeds: [embed] });
        const devembed = new MessageEmbed()
            .setTitle("This project is still very early in development")
            .setURL("https://github.com/Monko2k/SawadaBot")
            .setDescription(
                "Send feature requests/bug reports/invite requests to Monko2k#3672 on discord"
            );
        await match.initmsg.channel.send({ embeds: [devembed] });
        const game = new Game(match, gamechannel, lobbies);
        game.startGame();
        resolve(game);
    });
}

initDiscord();
