export interface Mappool {
  name: string;
  modgroups: Modgroup[];
}

export interface Modgroup {
    mod: string;
    maps: string[];
}