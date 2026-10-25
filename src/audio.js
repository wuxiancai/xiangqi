export function playMoveSound(audio, captured = false, side = 'red') {
  if (!audio || audio.state !== 'running') return;
  const now = audio.currentTime;
  if (captured) {
    playCaptureSound(audio, now, side);
    return;
  }
  const tone = audio.createOscillator();
  const volume = audio.createGain();
  tone.type = side === 'black' ? 'sine' : 'triangle';
  tone.frequency.setValueAtTime(side === 'black' ? 490 : 620, now);
  tone.frequency.exponentialRampToValueAtTime(side === 'black' ? 294 : 370, now + 0.075);
  volume.gain.setValueAtTime(0.0001, now);
  volume.gain.exponentialRampToValueAtTime(0.11, now + 0.008);
  volume.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
  tone.connect(volume).connect(audio.destination);
  tone.start(now);
  tone.stop(now + 0.095);
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
