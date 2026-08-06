import {PatternCell} from "../../models/pattern";
import type {SongChannelNoteContext} from "../../models/song";
import {kTic80EffectCommand, Tic80EffectCommand} from "../../models/tic80Capabilities";
import {
   formatMidiNoteFixedWidth,
   formatTicMidiNote,
} from "../../utils/music/noteRegistry";
import {
   TIC80_EFFECT_TICK_RATE_HZ,
   formatTic80Timing,
   type Tic80Timing
} from "../../utils/music/tic80Music";
import {
   tic80AnalyzeArpeggio,
   tic80AnalyzeSlide,
   tic80AnalyzeStereoVolume,
   tic80AnalyzeVibrato,
} from "../../utils/music/tic80EffectAnalysis";
import {
   tic80AnalyzePitchOffset,
   tic80PitchOffsetFromParam,
} from "../../utils/music/tic80Pitch";
import {CharMap, formatDecibels, formatSigned, formatSignedFixed, formatTiming, formatToDecimalPlaces, paramByte} from "../../utils/utils";

export type Tic80EffectInsight = {
   code: string;
   summary: string;
   detail?: string;
   explanation?: string;
   warning?: string;
};

function formatCentsRange(minCents: number, maxCents: number): string {
   const roundedMin = Math.round(minCents);
   const roundedMax = Math.round(maxCents);
   return roundedMin === roundedMax ?
      `${formatSigned(roundedMin)}c` :
      `${formatSigned(roundedMin)}/${formatSigned(roundedMax)}c`;
}

function appendWarning(current: string | undefined, next: string): string {
   return current ? `${current} ${next}` : next;
}

function formatPitchTarget(effectiveMidiNote: number): string {
   const nearestMidiNote = Math.round(effectiveMidiNote);
   const cents = Math.round((effectiveMidiNote - nearestMidiNote) * 100);
   const centsText = cents === 0 ? "" : ` ${formatSigned(cents)}c`;
   return `${formatMidiNoteFixedWidth(nearestMidiNote)}${centsText}`;
}

function describePitch(
   code: string,
   x: number,
   y: number,
   context: SongChannelNoteContext | undefined,
): Tic80EffectInsight {
   const offset = tic80PitchOffsetFromParam(paramByte(x, y));
   const offsetText = formatSigned(offset);
   const explanationPrefix =
      `${code} sets the pitch offset to ${offsetText} TIC-80 frequency units (P80 = 0). ` +
      `P commands do not accumulate.`;
   const baseMidiNote = context?.activeAfterNoteColumn?.midiNote;

   if (baseMidiNote === undefined) {
      return {
         code,
         summary: "Pitch",
         detail: offsetText,
         explanation:
            `${explanationPrefix} A base note is needed to convert this linear offset ` +
            `to a semitone interval and target note.`,
         warning: "No known base note.",
      };
   }

   const baseNoteText = formatMidiNoteFixedWidth(baseMidiNote);
   const pitchAnalysis = tic80AnalyzePitchOffset(baseMidiNote, offset);
   if (!pitchAnalysis) {
      return {
         code,
         summary: "Pitch",
         detail: offsetText,
         explanation: explanationPrefix,
         warning: `Base note ${baseNoteText} is out of range.`,
      };
   }

   if (pitchAnalysis.wrapped) {
      return {
         code,
         summary: "Pitch",
         detail: offsetText,
         explanation: explanationPrefix,
         warning:
            `Overflows and wraps!`
      };
   }

   if (pitchAnalysis.relativeSemitones === null || pitchAnalysis.effectiveMidiNote === null) {
      return {
         code,
         summary: "Pitch",
         detail: offsetText,
         explanation: explanationPrefix,
         warning:
            `At base ${baseNoteText}, this sets TIC-80's frequency register to zero.`
      };
   }

   const targetNoteText = formatPitchTarget(pitchAnalysis.effectiveMidiNote);
   const semitoneText = formatSignedFixed(pitchAnalysis.relativeSemitones, 2);

   return {
      code,
      summary: "Pitch",
      detail: `${offsetText} (${semitoneText} st → ${targetNoteText})`,
      explanation:
         `${explanationPrefix} At base ${baseNoteText}, this is ${semitoneText} semitones ` +
         `and a P-only target of ${targetNoteText}. TIC-80 pitch units are linear, so the ` +
         `semitone interval depends on the base note.`,
   };
}

function describeChord(
   code: string,
   x: number,
   y: number,
   context: SongChannelNoteContext|undefined,
   ): Tic80EffectInsight {
   const baseMidiNote = context?.activeAfterNoteColumn?.midiNote;
   if (x === 0 && y === 0) {
      return {
         code,
         summary: "Arpeggio off",
         explanation: `${code} clears the channel's native arpeggio offsets.`,
      };
   }

   const analysis = tic80AnalyzeArpeggio(x, y);
   const cadence = `${analysis.cycleTicks} TIC cycle, ${formatTiming(analysis.cycleSeconds)}`;
   const offsetText = analysis.noteOffsets.map(formatSigned).join(", ");
   const explanation =
      `${code} cycles semitone offsets ${offsetText}, one step per ` +
      `${TIC80_EFFECT_TICK_RATE_HZ} Hz TIC.`;
   if (baseMidiNote === undefined) {
      const offsetLabels = analysis.noteOffsets.map(
         offset => offset === 0 ? "root" : formatSigned(offset));
      return {
         code,
         summary: "Arpeggio",
         detail: `${offsetLabels.join(" ")} (${cadence})`,
         explanation,
         warning: "No known base note.",
      };
   }

   const noteLabels = analysis.noteOffsets.map(offset => formatMidiNoteFixedWidth(baseMidiNote + offset));
   return {
      code,
      summary: "Arpeggio",
      detail: `${noteLabels.join(" ")} (${cadence})`,
      explanation,
   };
}

function describeStereoVolume(code: string, x: number, y: number): Tic80EffectInsight {
   const analysis = tic80AnalyzeStereoVolume(x, y);
   return {
      code,
      summary: "Volume",
      detail:
         `L ${x}/15 (${formatDecibels(analysis.leftDecibels)}), ` +
         `R ${y}/15 (${formatDecibels(analysis.rightDecibels)})`,
      explanation:
         `${code} sets this channel's left and right linear gains independently.`,
   };
}

function describeSlide(
   code: string,
   x: number,
   y: number,
   cell: PatternCell,
   context: SongChannelNoteContext | undefined,
   timing: Tic80Timing | undefined,
): Tic80EffectInsight {
   const ticks = paramByte(x, y);
   if (ticks === 0)
      return {code, summary: "Slide off", explanation: `${code} clears the native slide duration.`};

   const duration = formatTic80Timing(ticks, timing);
   const fromMidiNote = context?.activeBeforeRow?.midiNote;
   const toMidiNote = cell.noteOff ? undefined : cell.midiNote;
   const analysis = fromMidiNote === undefined || toMidiNote === undefined ? undefined :
      tic80AnalyzeSlide(fromMidiNote, toMidiNote, ticks);
   // no note known; talk only in detail about duration.
   if (!analysis) {
      return {
         code,
         summary: "Slide",
         detail: `duration ${duration}`,
         explanation:
            `${code} sets the native slide duration. Interpolation is over integral frequency register units.`,
      };
   }

   const fromNoteText = formatMidiNoteFixedWidth(analysis.fromMidiNote);
   const toNoteText = formatMidiNoteFixedWidth(analysis.toMidiNote);
   return {
      code,
      summary: "Slide",
      detail:
         `${fromNoteText} ${CharMap.RightArrow} ${toNoteText} (${formatSigned(analysis.intervalSemitones)} st) ` +
         `over ${duration}`,
      explanation:
         `${code} interpolates from frequency register ` +
         `${analysis.fromFrequencyRegister} to ${analysis.toFrequencyRegister} over ` +
         `${ticks} ticks at ${TIC80_EFFECT_TICK_RATE_HZ} Hz. Linear in integer ` +
         `frequency-register units, not semitones.`,
   };
}

function describeVibrato(
   code: string,
   x: number,
   y: number,
   context: SongChannelNoteContext | undefined,
): Tic80EffectInsight {
   if (x === 0 || y === 0) {
      return {
         code,
         summary: "Vibrato off",
         explanation: `${code} disables native vibrato.`,
      };
   }

   const baseMidiNote = context?.activeAfterNoteColumn?.midiNote;
   const analysis = tic80AnalyzeVibrato(x, y, baseMidiNote)!;
   const cycleText =
      `${analysis.cycleTicks} TIC cycle (${formatTiming(analysis.cycleSeconds)}, ` +
      `${formatToDecimalPlaces(analysis.cyclesPerSecond, 2)}Hz)`;
   const centsText = analysis.minCents === null || analysis.maxCents === null ? undefined :
      formatCentsRange(analysis.minCents, analysis.maxCents);
   const detail = `${cycleText}, depth ${analysis.depth}${centsText ? ` (${centsText})` : ""}`;
   const registerRange =
      `${formatSigned(analysis.minPitchOffset)} to ${formatSigned(analysis.maxPitchOffset)}`;
   const explanationPrefix =
      `${code} samples TIC-80's 32-point native vibrato waveform over ` +
      `${analysis.cycleTicks} ticks at ${TIC80_EFFECT_TICK_RATE_HZ} Hz. Depth ${y} produces ` +
      `sampled frequency-register offsets ${registerRange}.`;
   const explanationSuffix =
      ` Pitch units are linear, so the cents range depends on the base note. ` +
      `A V command replaces the previous vibrato; V commands do not accumulate.`;

   if (baseMidiNote === undefined) {
      return {
         code,
         summary: "Vibrato",
         detail,
         explanation: `${explanationPrefix}${explanationSuffix}`,
         warning: "No known base note; cents range unavailable.",
      };
   }

   if (analysis.wrapped || centsText === undefined) {
      return {
         code,
         summary: "Vibrato",
         detail,
         explanation: `${explanationPrefix}${explanationSuffix}`,
         warning: "The frequency register overflows or reaches zero across this vibrato range.",
      };
   }

   return {
      code,
      summary: "Vibrato",
      detail,
      explanation:
         `${explanationPrefix} At base ${formatMidiNoteFixedWidth(baseMidiNote)}, this is ` +
         `${centsText}.${explanationSuffix}`,
   };
}

export function describeTic80Effect(
   cell: PatternCell,
   context?: SongChannelNoteContext,
   timing?: Tic80Timing,
   ): Tic80EffectInsight|null {
   const effectInfo = kTic80EffectCommand.coerceByKey(cell.tic80Effect);
   if (!effectInfo)
      return null;

   const x = (cell.tic80EffectX ?? 0);
   const y = (cell.tic80EffectY ?? 0);
   const code = `${effectInfo.patternChar}${x.toString(16).toUpperCase()}${y.toString(16).toUpperCase()}`;
   const command: Tic80EffectCommand = effectInfo.key;
   let insight: Tic80EffectInsight;

   switch (command) {
      case kTic80EffectCommand.key.M:
         insight = describeStereoVolume(code, x, y);
         break;

      case kTic80EffectCommand.key.C:
         insight = describeChord(code, x, y, context);
         break;

      case kTic80EffectCommand.key.J:
         insight = {
            code,
            summary: "Jump (unsupported)",
            detail: `frame ${x}, beat ${y} (row ${y * 4})`,
            warning: "TIC-80 jump commands not supported by Somatic (use Somatic 'C' command).",
         };
         break;

      case kTic80EffectCommand.key.S: {
         insight = describeSlide(code, x, y, cell, context, timing);
         break;
      }

      case kTic80EffectCommand.key.P: {
         insight = describePitch(code, x, y, context);
         break;
      }

      case kTic80EffectCommand.key.V:
         insight = describeVibrato(code, x, y, context);
         break;

      case kTic80EffectCommand.key.D: {
         const ticks = paramByte(x, y);
         const duration = formatTic80Timing(ticks, timing);
         if (cell.noteOff) {
            insight = {
               code,
               summary: "Delay",
               detail: ticks === 0 ? "note cut immediately" : `note cut after ${duration}`,
            };
         } else if (cell.midiNote !== undefined) {
            insight = {
               code,
               summary: "Delay",
               detail: ticks === 0 ?
                  `${formatTicMidiNote(cell.midiNote)} immediately` :
                  `${formatTicMidiNote(cell.midiNote)} after ${duration}`,
            };
         } else {
            insight = ticks === 0 ?
               {code, summary: "Delay off"} :
               {code, summary: "Delay", detail: `row event after ${duration}`};
         }
         break;
      }

      default: {
         const exhaustive: never = command;
         return exhaustive;
      }
   }

   if (context && !context.rowReachable) {
      insight.warning = appendWarning(insight.warning, "This row is after the pattern end and will not play.");
   }
   return insight;
}

export function formatTic80EffectInsight(insight: Tic80EffectInsight): string {
   return `${insight.code}: ${insight.summary}${insight.detail ? `: ${insight.detail}` : ""}`;
}

export function formatTic80EffectTooltip(insight: Tic80EffectInsight): string | undefined {
   const parts = [insight.explanation, insight.warning].filter((part): part is string => !!part);
   return parts.length > 0 ? parts.join(" ") : undefined;
}
