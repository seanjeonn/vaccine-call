// 훈련 통화(F1)의 수신 오디오에 전화선 특성을 입힌다.
//
// 협대역 전화 코딩은 "전화 같다"는 연출일 뿐 아니라 합성음의 흔적을 실제로 가린다.
// ASVspoof 2021 LA 실측에서 상위 탐지 시스템 전부가 협대역(G.711 a-law/µ-law 8kHz, GSM-FR)에서
// 광대역보다 성능이 나빴다. 네트워크 경로는 코덱에 비해 영향이 미미해 코덱 특성만 재현하면 된다.
// (IEEE/ACM TASLP 2023, DOI 10.1109/TASLP.2023.3285283)
//
// 배선 주의: 필터 출력을 ctx.destination으로 바로 보내면 브라우저 에코 제거(AEC)의 참조 신호에서
// 빠질 수 있다. 그러면 사기꾼 목소리가 마이크로 되돌아가고 서버 VAD가 이를 사용자 발화로 오인해
// 통화가 스스로 끊긴다. 그래서 MediaStreamDestination으로 받아 기존 <audio> 재생 경로를 유지한다.

// 필터를 끄고 원본과 A/B로 들어보려면 false로 바꾼다. (블라인드 청취 비교용)
export const TELEPHONE_LINE_ENABLED = true;

// 전화 대역폭 실질 구간. 8kHz 샘플링 전화망이 실제로 통과시키는 범위다.
const BAND_LOW_HZ = 300;
const BAND_HIGH_HZ = 3400;
// 무음 구간의 "죽은 정적"을 없애는 회선 잡음. 의식되면 안 되므로 아주 작게.
const LINE_NOISE_GAIN = 0.006;
const NOISE_LOOP_SECONDS = 2;

export type TelephoneLine = {
  stream: MediaStream;
  stop: () => void;
};

// G.711 µ-law 압신 + 8비트 양자화를 그대로 되돌린 곡선. WaveShaper는 메모리 없는 매핑이라
// 이 표 하나로 실제 µ-law 왕복과 같은 계단 잡음이 생긴다.
function muLawCurve(points: number) {
  const MU = 255;
  const denom = Math.log(1 + MU);
  // WaveShaper.curve는 SharedArrayBuffer를 받지 않는다. 버퍼를 직접 만들어 타입을 좁힌다.
  const curve = new Float32Array(new ArrayBuffer(points * Float32Array.BYTES_PER_ELEMENT));
  for (let i = 0; i < points; i++) {
    const x = (i / (points - 1)) * 2 - 1;
    const sign = x < 0 ? -1 : 1;
    const magnitude = Math.min(1, Math.abs(x));
    // 압신 → 7비트 크기 양자화(부호 1비트 + 크기 7비트) → 신장
    const companded = Math.log(1 + MU * magnitude) / denom;
    const quantized = Math.round(companded * 127) / 127;
    curve[i] = sign * ((Math.pow(1 + MU, quantized) - 1) / MU);
  }
  return curve;
}

function createLineNoise(ctx: AudioContext): AudioBufferSourceNode {
  const length = Math.floor(ctx.sampleRate * NOISE_LOOP_SECONDS);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) channel[i] = Math.random() * 2 - 1;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  return source;
}

// 원격 오디오 스트림에 전화선 체인을 걸어 재생용 스트림을 돌려준다.
export function applyTelephoneLine(ctx: AudioContext, source: MediaStream): TelephoneLine {
  const input = ctx.createMediaStreamSource(source);

  const highpass = ctx.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = BAND_LOW_HZ;
  highpass.Q.value = 0.7;

  const lowpass = ctx.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = BAND_HIGH_HZ;
  lowpass.Q.value = 0.7;

  // 수화기 특유의 중역 강조. 협대역으로 깎인 목소리에 존재감을 돌려준다.
  const presence = ctx.createBiquadFilter();
  presence.type = "peaking";
  presence.frequency.value = 2000;
  presence.gain.value = 6;
  presence.Q.value = 1.5;

  // 전화망 compand 대용. 작은 소리를 끌어올려 다이내믹을 좁힌다.
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -28;
  compressor.knee.value = 12;
  compressor.ratio.value = 6;
  compressor.attack.value = 0.004;
  compressor.release.value = 0.12;

  const codec = ctx.createWaveShaper();
  codec.curve = muLawCurve(2048);

  // 압축 + 중역 강조로 붙은 이득을 되돌려 클리핑을 막는다.
  const trim = ctx.createGain();
  trim.gain.value = 0.85;

  const destination = ctx.createMediaStreamDestination();

  input.connect(highpass);
  highpass.connect(lowpass);
  lowpass.connect(presence);
  presence.connect(compressor);
  compressor.connect(codec);
  codec.connect(trim);
  trim.connect(destination);

  // 회선 잡음도 같은 대역으로 잘라서 섞는다. 밖에서 만든 소음 에셋을 받지 않는다.
  const noise = createLineNoise(ctx);
  const noiseHighpass = ctx.createBiquadFilter();
  noiseHighpass.type = "highpass";
  noiseHighpass.frequency.value = BAND_LOW_HZ;
  const noiseLowpass = ctx.createBiquadFilter();
  noiseLowpass.type = "lowpass";
  noiseLowpass.frequency.value = BAND_HIGH_HZ;
  const noiseGain = ctx.createGain();
  noiseGain.gain.value = LINE_NOISE_GAIN;

  noise.connect(noiseHighpass);
  noiseHighpass.connect(noiseLowpass);
  noiseLowpass.connect(noiseGain);
  noiseGain.connect(destination);
  noise.start();

  return {
    stream: destination.stream,
    stop: () => {
      try {
        noise.stop();
      } catch {
        // 이미 멈춘 경우
      }
      for (const node of [
        input,
        highpass,
        lowpass,
        presence,
        compressor,
        codec,
        trim,
        noise,
        noiseHighpass,
        noiseLowpass,
        noiseGain,
      ]) {
        node.disconnect();
      }
    },
  };
}
