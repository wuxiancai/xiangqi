export function playMoveSound(audio, captured = false) {
  if (!audio || audio.state !== 'running') return;
  const now = audio.currentTime;
  if (captured) {
    playCaptureSound(audio, now);
    return;
  }
  const tone = audio.createOscillator();
  const volume = audio.createGain();
  tone.type = 'triangle';
  tone.frequency.setValueAtTime(620, now);
  tone.frequency.exponentialRampToValueAtTime(370, now + 0.075);
  volume.gain.setValueAtTime(0.0001, now);
  volume.gain.exponentialRampToValueAtTime(0.11, now + 0.008);
  volume.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
  tone.connect(volume).connect(audio.destination);
  tone.start(now);
  tone.stop(now + 0.095);
}

function playCaptureSound(audio, now) {
  const impact = audio.createOscillator();
  const impactVolume = audio.createGain();
  impact.type = 'sine';
  impact.frequency.setValueAtTime(125, now);
  impact.frequency.exponentialRampToValueAtTime(52, now + 0.16);
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
  for (const offset of [0, 0.075]) {
    const strike = audio.createBufferSource();
    const filter = audio.createBiquadFilter();
    const volume = audio.createGain();
    strike.buffer = buffer;
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1150, now + offset);
    volume.gain.setValueAtTime(0.0001, now + offset);
    volume.gain.exponentialRampToValueAtTime(0.23, now + offset + 0.003);
    volume.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.045);
    strike.connect(filter).connect(volume).connect(audio.destination);
    strike.start(now + offset);
    strike.stop(now + offset + 0.05);
  }
}
