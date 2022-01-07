import { Message } from "discord.js";
import { User } from "nodesu";
import { Mappool } from "./Mappool";

export interface MatchInfo {
    matchcode: string;
    mappool: Mappool;
    bestOf: number;
    teamSize: number;
    redPlayers: User[];
    bluePlayers: User[];
    allPlayers: string[]; // this was gonna be used for invites, but you can't invite with user IDs
    initmsg: Message; // so for now I'm just gonna use it for dupe player checking
}
