import assert from 'node:assert/strict';
import test from 'node:test';
import { FrameScheduler } from '../src/client/performance/frame-scheduler';
import { SnapshotClock } from '../src/client/animation/snapshot-clock';
import { EffectTimeline } from '../src/client/animation/effect-timeline';
import { UnitInterpolator } from '../src/client/animation/unit-interpolator';
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

test('unit movement stays continuous between irregular snapshots', () => {
  const animator = new UnitInterpolator();
  animator.sync('battle', [{id:'p',x:0,y:0}], 1000);
  animator.sync('battle', [{id:'p',x:1,y:0}], 1100);
  assert.ok(Math.abs(animator.position('p',1150)!.x - .5) < .001);
  const before = animator.position('p',1170)!.x;
  animator.sync('battle', [{id:'p',x:2,y:0}], 1170);
  assert.ok(Math.abs(animator.position('p',1170)!.x - before) < .001);
  animator.sync('battle', [{id:'p',x:10,y:0}], 1300);
  assert.equal(animator.position('p',1300)!.x,10,'large relocation must snap');
  animator.sync('next', [{id:'q',x:7,y:8}], 1400);
  assert.equal(animator.position('p',1400),null,'expired unit must be evicted');
});
