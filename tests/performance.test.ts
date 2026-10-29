import assert from 'node:assert/strict';
import test from 'node:test';
import { FrameScheduler } from '../src/client/performance/frame-scheduler';
import { SnapshotClock } from '../src/client/animation/snapshot-clock';
import { EffectTimeline } from '../src/client/animation/effect-timeline';
import type { CombatEffect } from '../server/types';

test('visual frames never control game time; unlimited mode follows requestAnimationFrame', () => {
  const scheduler = new FrameScheduler(0);
  assert.ok(scheduler.nextFrame(1000));
  assert.ok((scheduler.nextFrame(1006.94) || 0) > 0);
  assert.ok((scheduler.nextFrame(1013.88) || 0) > 0);
});

test('capped mode skips rendering safely without speeding up elapsed time', () => {
  const scheduler = new FrameScheduler(60);
  assert.ok(scheduler.nextFrame(1000));
  assert.equal(scheduler.nextFrame(1006), null);
  assert.equal(scheduler.nextFrame(1012), null);
  assert.ok((scheduler.nextFrame(1017) || 0) > 0);
  assert.equal(scheduler.nextFrame(1200), .05);
});

test('snapshot clock rejects out of order messages and bounds visual lead', () => {
  const clock = new SnapshotClock();
  assert.equal(clock.accept(5, 1000), true);
  assert.equal(clock.accept(4, 1050), false);
  assert.equal(clock.accept(5, 1055), false);
  assert.equal(clock.leadSeconds(1070), .07);
  assert.equal(clock.leadSeconds(1300), .14);
  clock.reset();
  assert.equal(clock.accept(1, 2000), true);
});

test('effect renderer interpolates time without mutating combat rules or rewinding', () => {
  const fx = { id:'fx',time:.2,duration:1,kind:'flame' } as CombatEffect;
  const timeline = new EffectTimeline();
  timeline.sync('round', [fx]);
  assert.equal(timeline.time(fx,.1), .30000000000000004);
  assert.equal(fx.time, .2);
  assert.equal(timeline.time(fx,0), .30000000000000004);
  timeline.sync('new-round', [fx]);
  assert.equal(timeline.time(fx,0), .2);
});
