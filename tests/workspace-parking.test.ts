import test from "node:test";
import assert from "node:assert/strict";
import { WorkspaceParking } from "../src/workspace-parking";

function fixture() {
  const writes: string[] = [];
  const target = {
    set inert(value: boolean) { writes.push(`inert:${value}`); },
    style: { set contentVisibility(value: string) { writes.push(`content:${value}`); } },
  };
  return { writes, parking: new WorkspaceParking(target) };
}

test("entry removes native inertness before revealing the cached workspace", () => {
  const { writes, parking } = fixture();
  assert.equal(parking.begin(true)(), false);
  assert.deepEqual(writes, ["inert:false", "content:visible"]);
});

test("exiting does not hide or make content inert until the animation completes", () => {
  const { writes, parking } = fixture();
  const finish = parking.begin(false);
  assert.deepEqual(writes, []);
  assert.equal(finish(), true);
  assert.deepEqual(writes, ["content:hidden", "inert:true"]);
});

test("rapid re-entry and canceled exits cannot park the newly active workspace", () => {
  const { writes, parking } = fixture();
  const oldExit = parking.begin(false);
  parking.begin(true);
  assert.equal(oldExit(), false);
  const nextExit = parking.begin(false);
  assert.equal(oldExit(), false);
  parking.cancel();
  assert.equal(nextExit(), false);
  assert.deepEqual(writes, ["inert:false", "content:visible"]);
});
