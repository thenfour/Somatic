import {NoteRegistry} from "./noteRegistry";


export const TIC80_PITCH_NEUTRAL_PARAM = 0x80;
export const TIC80_FREQUENCY_REGISTER_MODULUS = 0x1000;

export type Tic80PitchOffsetAnalysis = Readonly<{
   baseFrequencyRegister: number;
   unwrappedTargetFrequencyRegister: number;
   targetFrequencyRegister: number;
   wrapped: boolean;
   relativeSemitones: number|null;
   effectiveMidiNote: number|null;
}>;

/**
 * TIC-80's native NoteFreqs table contains rounded integer frequencies:
 * https://github.com/nesbox/TIC-80/blob/4aba09c98f1e5028b82765be1647677b08d35942/src/core/sound.c#L38-L39
 */
export function tic80FrequencyRegisterForPatternMidiNote(midiNote: number): number|undefined {
   const note = NoteRegistry.get(midiNote);
   return note?.tic.isPatternEncodable ? Math.round(note.frequencyHz) : undefined;
}

/**
 * TIC-80 stores frequency as an 8-bit low value plus a 4-bit high value, so
 * values passed to the native setter are observable modulo 4096:
 * https://github.com/nesbox/TIC-80/blob/4aba09c98f1e5028b82765be1647677b08d35942/src/tic.h#L412-L434
 */
export function tic80WrapFrequencyRegister(frequencyRegister: number): number {
   return ((frequencyRegister % TIC80_FREQUENCY_REGISTER_MODULUS) +
      TIC80_FREQUENCY_REGISTER_MODULUS) % TIC80_FREQUENCY_REGISTER_MODULUS;
}

/** Converts a positive frequency ratio to its equal-tempered interval. */
export function semitonesBetweenFrequencies(baseFrequency: number, targetFrequency: number): number {
   return 12 * Math.log2(targetFrequency / baseFrequency);
}

/** Pxx stores XY-128 as the channel's non-cumulative fine-pitch offset. */
export function tic80PitchOffsetFromParam(param: number): number {
   return param - TIC80_PITCH_NEUTRAL_PARAM;
}

/**
 * Native Pxx flow:
 * - decode and store XY-128:
 *   https://github.com/nesbox/TIC-80/blob/4aba09c98f1e5028b82765be1647677b08d35942/src/core/sound.c#L397-L403
 * - add that value to the pitch passed into sfx:
 *   https://github.com/nesbox/TIC-80/blob/4aba09c98f1e5028b82765be1647677b08d35942/src/core/sound.c#L438-L447
 * - add pitch directly to NoteFreqs[note] before writing the register:
 *   https://github.com/nesbox/TIC-80/blob/4aba09c98f1e5028b82765be1647677b08d35942/src/core/sound.c#L188-L197
 */
export function tic80AnalyzePitchOffset(
   baseMidiNote: number,
   pitchOffset: number,
   ): Tic80PitchOffsetAnalysis|undefined {
   const baseFrequencyRegister = tic80FrequencyRegisterForPatternMidiNote(baseMidiNote);
   if (baseFrequencyRegister === undefined)
      return undefined;

   const unwrappedTargetFrequencyRegister = baseFrequencyRegister + pitchOffset;
   const targetFrequencyRegister = tic80WrapFrequencyRegister(unwrappedTargetFrequencyRegister);
   const wrapped = unwrappedTargetFrequencyRegister !== targetFrequencyRegister;
   const relativeSemitones = targetFrequencyRegister === 0 ? null :
      semitonesBetweenFrequencies(baseFrequencyRegister, targetFrequencyRegister);

   return {
      baseFrequencyRegister,
      unwrappedTargetFrequencyRegister,
      targetFrequencyRegister,
      wrapped,
      relativeSemitones,
      // Anchor to the nominal note so P80 remains exactly neutral despite the
      // small tuning error introduced by TIC-80's rounded NoteFreqs table.
      effectiveMidiNote: relativeSemitones === null ? null : baseMidiNote + relativeSemitones,
   };
}
