export function linearGainToDecibels(gain: number): number {
   return gain <= 0 ? Number.NEGATIVE_INFINITY : 20 * Math.log10(gain);
}

export function dbToLinear(dbfs: number): number {
   return Math.pow(10, dbfs / 20);
}

export function millisecondsToAudioFrames(milliseconds: number, sampleRateHz: number): number {
   return Math.max(0, Math.round(milliseconds * sampleRateHz / 1000));
}

// sample is PCM16 sample in range [-32768, 32767], gain is linear gain factor
export function applyPcm16Gain(sample: number, gain: number): number {
   if (gain === 1) return sample;
   return Math.max(-32768, Math.min(32767, Math.round(sample * gain)));
}
