import {
    BanchoLobby,
    BanchoLobbyPlayer,
    BanchoLobbyTeamModes,
    BanchoLobbyWinConditions,
    BanchoMod,
    BanchoMods,
    BanchoMultiplayerChannel,
} from "bancho.js";
import { MatchInfo } from "../definitions/Match";
import * as crypto from "crypto";
import { Mode } from "nodesu";
import { Mappool } from "../definitions/Mappool";

export class Game {
    channel: BanchoMultiplayerChannel;
    pickindex = 1;
    pointsRed = 0;
    pointsBlue = 0;
    pickorder: number[] = [];
    match: MatchInfo;
    collector: BanchoLobby[];
    timeout = setTimeout(() => {
        this.timeoutLobby();
    }, 300000);

    constructor(
        match: MatchInfo,
        channel: BanchoMultiplayerChannel,
        collector: BanchoLobby[]
    ) {
        this.match = match;
        this.channel = channel;
        this.collector = collector;
        this.setOrder();
    }

    private setOrder(): void {
        let counts: number[] = [];
        for (let i = 0; i < this.match.mappool.modgroups.length - 1; i++) {
            counts.push(this.match.mappool.modgroups[i].maps.length);
        }
        while (this.pickorder.length < this.match.bestOf) {
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
            this.pickorder = this.pickorder.concat(set);
        }
    }

    public async startGame(): Promise<void> {
        const lobby = this.channel.lobby;
        await lobby.setSettings(
            BanchoLobbyTeamModes.TeamVs,
            BanchoLobbyWinConditions.ScoreV2,
            this.match.teamSize * 2
        );
        await lobby.lockSlots();
        await lobby.updateSettings();
        await this.setRandomBeatmap(
            this.channel,
            this.match.mappool,
            this.pickorder[0]
        );
        await lobby.setPassword(crypto.randomBytes(10).toString("hex"));
        for (const player of this.match.redPlayers) {
            await lobby.invitePlayer(player.username);
        }
        for (const player of this.match.bluePlayers) {
            await lobby.invitePlayer(player.username);
        }
        this.eventHandle();
    }

    private eventHandle() {
        const tie =
            this.match.bestOf > 1 &&
            this.pointsRed === this.pointsBlue &&
            this.pointsBlue === Math.floor(this.match.bestOf / 2);
        const winpoints = Math.ceil(this.match.bestOf / 2);
        const channel = this.channel!;
        const lobby = channel.lobby;
        lobby.on("allPlayersReady", async () => {
            console.log(lobby.slots);
            //TODO: check that the lobby is full
            //not sure what to do for if the players want the match to continue while missing a player
            await lobby.startMatch(10);
        });

        lobby.on("matchStarted", () => {
            clearTimeout(this.timeout);
        });

        lobby.on("matchFinished", async () => {
            this.timeout = setTimeout(() => {
                this.timeoutLobby();
            }, 300000);
            let scoreRed = 0;
            let scoreBlue = 0;
            const scores = lobby.scores;
            //TODO: Add NM debuff for FM
            for (let i = 0; i < scores.length; i++) {
                if (scores[i].pass) {
                    let score = scores[i].score;
                    if (lobby.freemod && !tie) {
                        console.log(scores[i].player.mods.length);
                        // player mods doesn't work
                    }
                    scores[i].player.team === "Red"
                        ? (scoreRed += score)
                        : (scoreBlue += score);
                }
            }
            const diff = Math.abs(scoreRed - scoreBlue);
            if (scoreRed > scoreBlue) {
                channel.sendMessage(`Red wins by ${diff}`);
                this.pointsRed++;
            } else if (scoreBlue > scoreRed) {
                channel.sendMessage(`Blue wins by ${diff}`);
                this.pointsBlue++;
            } else {
                channel.sendMessage("Tied scores: Neither team earns a point");
            }
            this.sendScore();
            if (this.pointsRed === winpoints) {
                channel.sendMessage("Red wins the match");
                this.endMatch();
            } else if (this.pointsBlue === winpoints) {
                channel.sendMessage("Blue wins the match");
                this.endMatch();
            } else if (tie) {
                channel.sendMessage(
                    "Scores are tied. A tiebreaker will be played"
                );
                await this.setTieBreaker();
            } else {
                this.pickindex++;
                await this.setRandomBeatmap(
                    this.channel!,
                    this.match.mappool,
                    this.pickorder[this.pickindex]
                );
            }
        });

        lobby.on("playerJoined", async (res) => {
            this.resetTimeout();
            await this.setTeam(res.player);
        });
    }

    private sendScore() {
        this.channel.sendMessage(
            `Current Score: Red ${this.pointsRed} : ${this.pointsBlue} Blue`
        );
    }
    private async endMatch() {
        this.channel.sendMessage(
            `Final score: Red ${this.pointsRed} : ${this.pointsBlue} Blue`
        );
        this.channel.sendMessage(
            "Lobby will automatically close in 30 seconds"
        );
        setTimeout(async () => {
            await this.channel.lobby.closeLobby();
        }, 30000);
        // I think this can fail if two lobbies end at exactly the same time
        // this bot isn't designed to be used by a lot of people at once so I will assume that this is ok for now lol
        this.collector.splice(this.collector.indexOf(this.channel.lobby), 1);
    }
    private async setTeam(player: BanchoLobbyPlayer) {
        if (
            this.match.redPlayers.filter((e) => e.userId === player.user.id)
                .length > 0
        ) {
            await this.channel.lobby.changeTeam(player, "Red");
        } else if (
            this.match.bluePlayers.filter((e) => e.userId === player.user.id)
                .length > 0
        ) {
            await this.channel.lobby.changeTeam(player, "Blue");
        } else {
            await this.channel.lobby.kickPlayer(player.user.username);
        }
    }
    private async setTieBreaker() {
        const modgroup = this.match.mappool.modgroups.at(-1)!;
        const mapindex = Math.floor(Math.random() * modgroup.maps.length);
        const map = Number(modgroup.maps[mapindex]);
        await this.channel.lobby.setMap(map, Mode.osu);
        await this.channel.lobby.setMods([BanchoMods.None], true);
    }

    private async setRandomBeatmap(
        channel: BanchoMultiplayerChannel,
        mappool: Mappool,
        modgroupindex: number
    ) {
        const lobby = channel.lobby;
        const modgroup = mappool.modgroups[modgroupindex];
        let mapindex = Math.floor(Math.random() * modgroup.maps.length);
        while (modgroup.maps[mapindex] === "0") {
            mapindex = Math.floor(Math.random() * modgroup.maps.length);
            console.log("roll");
        }
        const map = Number(modgroup.maps[mapindex]);
        mappool.modgroups[modgroupindex].maps[mapindex] = "0";
        let mods: BanchoMod[];
        let freemod = false;
        // no idea why modstring doesn't work Lol
        switch (modgroup.mod) {
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
                mods = [BanchoMods.None];
                freemod = true;
                break;
        }
        channel.sendMessage(`Next Map: ${modgroup.mod}${mapindex + 1}`);
        if (freemod) {
            channel.sendMessage(
                "Allowed Mods: HD, HR, EZ, FL, NF, NM (0.7x multiplier)"
            );
            channel.sendMessage(
                "just kidding bot can't acceses mod data yet so do whatever Lol"
            );
        }
        await lobby.setMap(map, Mode.osu);
        await lobby.setMods(mods!, freemod);
    }

    private resetTimeout() {
        clearTimeout(this.timeout);
        this.timeout = setTimeout(() => {
            this.timeoutLobby();
        }, 300000);
    }

    private timeoutLobby() {
        this.channel.sendMessage("Lobby closed due to inactivity");
        this.channel.lobby.closeLobby();
        this.collector.splice(this.collector.indexOf(this.channel.lobby), 1);
    }
}
