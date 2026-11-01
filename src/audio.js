export function playMoveSound(audio, captured = false, side = 'red') {
  if (!audio || audio.state !== 'running') return;
  const now = audio.currentTime;
  if (captured) {
    playCaptureSound(audio, now, side);
    return;
  }
  playWoodenMoveSound(audio, now, side);
}

function playWoodenMoveSound(audio, now, side) {
  const darkPiece = side === 'black';
  const body = audio.createOscillator();
  const bodyVolume = audio.createGain();
  body.type = 'triangle';
  body.frequency.setValueAtTime(darkPiece ? 285 : 340, now);
  body.frequency.exponentialRampToValueAtTime(darkPiece ? 205 : 245, now + 0.045);
  bodyVolume.gain.setValueAtTime(0.0001, now);
  bodyVolume.gain.exponentialRampToValueAtTime(0.19, now + 0.0015);
  bodyVolume.gain.exponentialRampToValueAtTime(0.0001, now + 0.075);
  body.connect(bodyVolume).connect(audio.destination);
  body.start(now);
  body.stop(now + 0.08);

  const resonance = audio.createOscillator();
  const resonanceVolume = audio.createGain();
  resonance.type = 'sine';
  resonance.frequency.setValueAtTime(darkPiece ? 155 : 190, now);
  resonance.frequency.exponentialRampToValueAtTime(darkPiece ? 120 : 145, now + 0.06);
  resonanceVolume.gain.setValueAtTime(0.0001, now);
  resonanceVolume.gain.exponentialRampToValueAtTime(0.075, now + 0.002);
  resonanceVolume.gain.exponentialRampToValueAtTime(0.0001, now + 0.085);
  resonance.connect(resonanceVolume).connect(audio.destination);
  resonance.start(now);
  resonance.stop(now + 0.09);

  const sampleRate = audio.sampleRate;
  const buffer = audio.createBuffer(1, Math.ceil(sampleRate * 0.012), sampleRate);
  const samples = buffer.getChannelData(0);
  for (let index = 0; index < samples.length; index += 1) {
    const envelope = Math.exp(-index / (sampleRate * 0.002));
    samples[index] = (Math.random() * 2 - 1) * envelope;
  }
  const click = audio.createBufferSource();
  const filter = audio.createBiquadFilter();
  const clickVolume = audio.createGain();
  click.buffer = buffer;
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(darkPiece ? 1450 : 1750, now);
  filter.Q.setValueAtTime(0.65, now);
  clickVolume.gain.setValueAtTime(0.0001, now);
  clickVolume.gain.exponentialRampToValueAtTime(0.2, now + 0.0008);
  clickVolume.gain.exponentialRampToValueAtTime(0.0001, now + 0.012);
  click.connect(filter).connect(clickVolume).connect(audio.destination);
  click.start(now);
  click.stop(now + 0.013);
}

export function playCheckSound(speech = globalThis.speechSynthesis, Utterance = globalThis.SpeechSynthesisUtterance) {
  speakChinese(speech, Utterance, '将军');
}

export function playCaptureSpeech(speech = globalThis.speechSynthesis, Utterance = globalThis.SpeechSynthesisUtterance) {
  speakChinese(speech, Utterance, '吃');
}

export function playTacticSpeech(phrase, speech = globalThis.speechSynthesis, Utterance = globalThis.SpeechSynthesisUtterance) {
  speakChinese(speech, Utterance, phrase);
}

function speakChinese(speech, Utterance, phrase) {
  if (!speech || !Utterance) return;
  const utterance = new Utterance(phrase);
  utterance.lang = 'zh-CN';
  utterance.rate = 1;
  utterance.pitch = 1;
  utterance.volume = 1;
  utterance.voice = speech.getVoices?.().find((voice) => /^zh(?:[-_]|$)/i.test(voice.lang)) ?? null;
  speech.speak(utterance);
}

function playCaptureSound(audio, now, side) {
  const impact = audio.createOscillator();
  const impactVolume = audio.createGain();
  impact.type = 'sine';
  impact.frequency.setValueAtTime(side === 'black' ? 95 : 140, now);
  impact.frequency.exponentialRampToValueAtTime(side === 'black' ? 42 : 58, now + 0.16);
  impactVolume.gain.setValueAtTime(0.0001, now);
  impactVolume.gain.exponentialRampToValueAtTime(0.2, now + 0.004);
  impactVolume.gain.exponentialRampToValueAtTime(0.0001, now + 0.17);
  impact.connect(impactVolume).connect(audio.destination);
  impact.start(now);
  impact.stop(now + 0.18);

  const sampleRate = audio.sampleRate;
  const buffer = audio.createBuffer(1, Math.ceil(sampleRate * 0.045), sampleRate);
  const samples = buffer.getChannelData(0);
  for (let index = 0; index < samples.length; index += 1) samples[index] = Math.random() * 2 - 1;
  for (const offset of (side === 'black' ? [0, 0.11] : [0, 0.075])) {
    const strike = audio.createBufferSource();
    const filter = audio.createBiquadFilter();
    const volume = audio.createGain();
    strike.buffer = buffer;
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(side === 'black' ? 850 : 1400, now + offset);
    volume.gain.setValueAtTime(0.0001, now + offset);
    volume.gain.exponentialRampToValueAtTime(0.23, now + offset + 0.003);
    volume.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.045);
    strike.connect(filter).connect(volume).connect(audio.destination);
    strike.start(now + offset);
    strike.stop(now + offset + 0.05);
  }
}
