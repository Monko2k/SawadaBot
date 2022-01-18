import { Client, User } from "nodesu";
import {
    Client as DiscordClient,
    Intents,
    MappedInteractionTypes,
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
        // apparently this works
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
            .then(() => awaitResponse(m))
            .then((res) => {
                teamSize = Number(res);
                if (Number.isNaN(teamSize) || teamSize < 1 || teamSize > 8) {
                    throw "Invalid team size";
                }
                m.reply("Enter BestOf (1-13)");
            })
            .then(() => awaitResponse(m))
            .then((res) => {
                bestOf = Number(res);
                if (
                    bestOf < 1 ||
                    bestOf > 13 ||
                    !Number.isInteger(bestOf) ||
                    bestOf % 2 !== 1
                ) {
                    throw "Invalid bestOf";
                }
                m.reply("Enter Team 1 members (comma separated)");
            })
            .then(() => awaitResponse(m))
            .then((res) => {
                let redNames = res.split(",");
                if (redNames.length !== teamSize) {
                    throw "Invalid number of members";
                }
                return redNames.map((e) => e.trim());
            })
            .then((res) => validateMembers(res, all))
            .then((res) => {
                red = res;
                m.reply("Enter Team 2 members (comma separated)");
            })
            .then(() => awaitResponse(m))
            .then((res) => {
                let blueNames = res.split(",");
                if (blueNames.length !== teamSize) {
                    throw "Invalid number of members";
                }
                return blueNames.map((e) => e.trim());
            })
            .then((res) => validateMembers(res, all))
            .then((res) => {
                blue = res;
                m.reply(
                    "Enter Mappool (https://oma.hwc.hr/pools, 2800+ elo pools)"
                );
            })
            .then(() => awaitResponse(m))
            .then((res) => {
                const re = /[^//]+$/;
                if (re.test(res)) {
                    return res.match(re)![0];
                } else {
                    throw "Invalid mappool URL format";
                }
            })
            .then((res) => getPool(res, bestOf))
            .then((res) => {
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
                return match;
            })
            .then((res) => initGame(res))
            .then((res) => lobbies.push(res.channel.lobby))
            .catch((err) => m.channel.send(err));
    }
}

async function awaitResponse(m: Message): Promise<string> {
    const filter = (response: Message) => response.author.id === m.author.id;
    const response = m.channel
        .awaitMessages({ filter, max: 1, time: 45000, errors: ["time"] })
        .then((collected) => {
            return collected.first()!.content;
        })
        .catch(() => {
            return Promise.reject("Setup timed out");
        });
    return Promise.resolve(response);
}

function awaitConfirmReact(m: Message, u: DiscordUser): Promise<string> {
    // this function does not need to exist
    const filter = (reaction: MessageReaction, user: DiscordUser) =>
        user.id === u.id &&
        (reaction.emoji.name === "✅" || reaction.emoji.name == "❌");
    const reaction = m
        .awaitReactions({ filter, max: 1, time: 15000, errors: ["time"] })
        .then((collected) => {
            return collected.first()?.emoji.name!;
        })
        .catch(() => {
            return Promise.reject("Confirmation timed out");
        });
    return Promise.resolve(reaction);
}

function getPool(pool: string, bestof: number): Promise<Mappool> {
    // TODO: put the pools in a nosql db and query, instead of this shit
    const data = import("../pools/" + pool + ".json")
        .then((res) => {
            let mapcount = 0;
            for (let i = 0; i < res.modgroups.length - 1; i++) {
                mapcount += res.modgroups[i].maps.length;
            }
            if (mapcount < bestof) {
                return Promise.reject(
                    "Invalid pool (mappool is too small for this bestOf"
                );
            }
            return res as Mappool;
        })
        .catch(() => {
            return Promise.reject("Invalid Pool");
        });
    return Promise.resolve(data);
}

async function validateMembers(
    members: string[],
    allplayers: string[]
): Promise<Array<User>> {
    let users: User[] = [];
    for (let i = 0; i < members.length; i++) {
        const data = await api.user.get(members[i]);
        if (typeof data === "undefined") {
            return Promise.reject(`Couldn't find user ${members[i]}`);
        }
        const player = new User(data); // what the hellll
        if (allplayers.includes(player.userId.toString())) {
            return Promise.reject(
                `Player ${player.username} cannot be included multiple times`
            );
        }
        users.push(player);
        allplayers.push(player.userId.toString());
    }
    return Promise.resolve(users);
}

async function initGame(match: MatchInfo): Promise<Game> {
    let embed = new MessageEmbed()
        .setColor("#FFFFFF")
        .setTitle(`Sawada Scrim Match #${match.matchcode}`)
        .setDescription(`BO${match.bestOf} ${match.teamSize}v${match.teamSize}`)
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
        .setFooter({ text: "Confirm match settings to start the lobby" });
    const confirm = await match.initmsg.channel.send({ embeds: [embed] });
    await confirm.react("✅");
    await confirm.react("❌");
    const gamechannel = await awaitConfirmReact(confirm, match.initmsg.author)
        .then((res) => {
            //await confirm.reactions.removeAll(); need perms
            if (res !== "✅") {
                embed.setColor("#FF0000");
                throw "Match Cancelled";
            } else {
                embed.setColor("#72F795");
                embed.setFooter({ text: "Match confirmed, creating lobby..." });
            }
        })
        .then(() => confirm.edit({ embeds: [embed] }))
        .then(() => {
            if (banchoclient.isDisconnected()) {
                return banchoclient.connect();
            }
        })
        .then(() => {
            return banchoclient.createLobby(`Sawada Scrim #${match.matchcode}`);
        })
        .then((res) => {
            embed.setColor("#51E8FE");
            embed.setURL(
                `https://osu.ppy.sh/community/matches/${res.lobby.id}`
            );
            embed.setFooter({ text: "Match lobby has been created" });
            return res;
        })
        .catch((err) => {
            embed.setFooter(`❌ ${err}`);
            return Promise.reject(err);
        })
        .finally(() => confirm.edit({ embeds: [embed] }));

    await confirm.edit({ embeds: [embed] });
    const devembed = new MessageEmbed()
        .setTitle("This project is still very early in development")
        .setColor("#51E8FE")
        .setURL("https://github.com/Monko2k/SawadaBot")
        .setDescription(
            "Send feature requests and bug reports to Monko2k#3672 on discord"
        )
        .setFooter({
            text: "Want this bot for your own server? DM me for an invite",
        });
    await match.initmsg.channel.send({ embeds: [devembed] });
    const game = new Game(match, gamechannel, lobbies);
    game.startGame();
    return Promise.resolve(game);
}

initDiscord();
