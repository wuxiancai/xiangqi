import test from 'node:test';
import assert from 'node:assert/strict';
import { playMoveSound } from '../src/audio.js';

function createFakeAudio() {
  const created = { oscillators: 0, bufferSources: 0, filters: 0 };
  const parameter = { setValueAtTime() {}, exponentialRampToValueAtTime() {} };
  const node = () => ({ connect() { return this; }, start() {}, stop() {}, frequency: parameter, gain: parameter });
  return {
    state: 'running', currentTime: 1, sampleRate: 1000, destination: {}, created,
    createOscillator() { created.oscillators += 1; return node(); },
    createGain: node,
    createBufferSource() { created.bufferSources += 1; return node(); },
    createBiquadFilter() { created.filters += 1; return node(); },
    createBuffer(_channels, length) { return { getChannelData: () => new Float32Array(length) }; },
  };
}

test('ordinary move and capture sounds use distinct synthesis paths', () => {
  const moveAudio = createFakeAudio();
  playMoveSound(moveAudio, false);
  assert.deepEqual(moveAudio.created, { oscillators: 1, bufferSources: 0, filters: 0 });

  const captureAudio = createFakeAudio();
  playMoveSound(captureAudio, true);
  assert.deepEqual(captureAudio.created, { oscillators: 1, bufferSources: 2, filters: 2 });
});

test('sound remains silent until browser audio is unlocked', () => {
  const audio = createFakeAudio();
  audio.state = 'suspended';
  playMoveSound(audio, true);
  assert.deepEqual(audio.created, { oscillators: 0, bufferSources: 0, filters: 0 });
});
