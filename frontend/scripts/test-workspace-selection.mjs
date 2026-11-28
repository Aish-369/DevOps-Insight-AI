import assert from "node:assert/strict";
import {
  readActiveWorkspaceId,
  resolveActiveWorkspaceId,
  saveActiveWorkspaceId,
} from "../src/lib/workspaceSelection.js";

const values = new Map();
globalThis.window = {
  localStorage: {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  },
};

const userA = "user-a";
const userB = "user-b";
const workspaces = [{ id: "team-1" }, { id: "team-2" }];

saveActiveWorkspaceId(userA, "team-2");
assert.equal(readActiveWorkspaceId(userA), "team-2");
assert.equal(readActiveWorkspaceId(userB), null);
assert.equal(resolveActiveWorkspaceId(userA, "", workspaces), "team-2");
assert.equal(resolveActiveWorkspaceId(userA, "team-1", workspaces), "team-1");
assert.equal(resolveActiveWorkspaceId(userA, "deleted-team", workspaces), "team-2");

saveActiveWorkspaceId(userA, null);
assert.equal(readActiveWorkspaceId(userA), null);
assert.equal(resolveActiveWorkspaceId(userA, "", workspaces), "team-1");
assert.equal(resolveActiveWorkspaceId(userA, "", []), null);

globalThis.window.localStorage.setItem = () => {
  throw new Error("Storage is blocked");
};
globalThis.window.localStorage.getItem = () => {
  throw new Error("Storage is blocked");
};
saveActiveWorkspaceId(userA, "team-2");
assert.equal(readActiveWorkspaceId(userA), null);
assert.equal(resolveActiveWorkspaceId(userA, "", workspaces), "team-1");

console.log("Workspace selection tests passed (10 assertions).");
