import test from 'node:test';
import assert from 'node:assert/strict';
import { playCheckSound, playMoveSound } from '../src/audio.js';

function createFakeAudio() {
  const created = { oscillators: 0, bufferSources: 0, filters: 0 };
  const frequencies = [];
  const parameter = { setValueAtTime() {}, exponentialRampToValueAtTime() {} };
  const node = () => ({ connect() { return this; }, start() {}, stop() {}, frequency: parameter, gain: parameter });
  return {
    state: 'running', currentTime: 1, sampleRate: 1000, destination: {}, created, frequencies,
    createOscillator() { created.oscillators += 1; return { ...node(), frequency: { setValueAtTime(value) { frequencies.push(value); }, exponentialRampToValueAtTime() {} } }; },
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

test('red and black moves have distinct audio signatures', () => {
  const redAudio = createFakeAudio();
  const blackAudio = createFakeAudio();
  playMoveSound(redAudio, false, 'red');
  playMoveSound(blackAudio, false, 'black');
  assert.notDeepEqual(redAudio.frequencies, blackAudio.frequencies);
});

test('red and black captures have distinct audio signatures', () => {
  const redAudio = createFakeAudio();
  const blackAudio = createFakeAudio();
  playMoveSound(redAudio, true, 'red');
  playMoveSound(blackAudio, true, 'black');
  assert.notDeepEqual(redAudio.frequencies, blackAudio.frequencies);
});

test('sound remains silent until browser audio is unlocked', () => {
  const audio = createFakeAudio();
  audio.state = 'suspended';
  playMoveSound(audio, true);
  assert.deepEqual(audio.created, { oscillators: 0, bufferSources: 0, filters: 0 });
});


test('check notification speaks the Chinese phrase 将军 instead of synthesizing a beep', () => {
  const spoken = [];
  const speech = { getVoices: () => [{ lang: 'en-US' }, { lang: 'zh-CN', name: 'Chinese voice' }], speak: (utterance) => spoken.push(utterance), cancel() {} };
  class FakeUtterance { constructor(text) { this.text = text; } }
  playCheckSound(speech, FakeUtterance);
  assert.equal(spoken.length, 1);
  assert.equal(spoken[0].text, '将军');
  assert.equal(spoken[0].lang, 'zh-CN');
  assert.equal(spoken[0].voice.name, 'Chinese voice');
});
