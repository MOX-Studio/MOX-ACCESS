import test from 'node:test';
import assert from 'node:assert/strict';
import { weeklyQuota } from '../server/subscription-quota.mjs';
const now=1789120000000,week={usedPercent:64,windowDurationMins:10080,resetsAt:now/1000+3600},short={usedPercent:12,windowDurationMins:300,resetsAt:now/1000+60};
test('weekly quota is selected by duration in either window, not its position',()=>{
  for(const snapshot of [{primary:week,secondary:short},{primary:short,secondary:week}])assert.equal(weeklyQuota({...snapshot,checkedAt:now},now).remainingPercent,36);
  assert.equal(weeklyQuota({primary:{usedPercent:64},checkedAt:now},now).status,'unavailable');
});
test('passed reset and stale snapshots never manufacture a fresh percentage',()=>{
  assert.equal(weeklyQuota({primary:{...week,resetsAt:now/1000-1},checkedAt:now},now).status,'stale');
  assert.equal(weeklyQuota({primary:week,checkedAt:now-120000},now).remainingPercent,null);
});
test('Codex bucket is kept separate and conflicting weekly windows are unknown',()=>{
  const snapshot={checkedAt:now,buckets:[{limitId:'other',primary:{...week,usedPercent:20}},{limitId:'codex',primary:week}]};
  assert.equal(weeklyQuota(snapshot,now).remainingPercent,36);assert.equal(weeklyQuota(snapshot,now).limitId,'codex');
  assert.equal(weeklyQuota({checkedAt:now,primary:week,secondary:{...week,usedPercent:20}},now).status,'unavailable');
});

test('an explicitly different product never becomes the Codex weekly quota',()=>{
  assert.equal(weeklyQuota({checkedAt:now,limitId:'other',primary:week},now).status,'unavailable');
  assert.equal(weeklyQuota({checkedAt:now,buckets:[{limitId:'other',primary:week}]},now).status,'unavailable');
});
