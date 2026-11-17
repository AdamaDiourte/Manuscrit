export type {ObjectStore, StoredObject} from "./types";
export const env: NodeJS.ProcessEnv & {
  BUCKET: import("./types").ObjectStore;
};
