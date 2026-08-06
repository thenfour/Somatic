import {PatternCell} from "../../models/pattern";
import type {SongChannelNoteContext} from "../../models/song";
import {kTic80EffectCommand, Tic80Caps, Tic80EffectCommand} from "../../models/tic80Capabilities";
import {formatTicMidiNote} from "../../utils/music/noteRegistry";
import {
   formatTic80Timing,
   tic80EffectTicksToRows,
   tic80EffectTicksToSeconds,
   type Tic80Timing,
} from "../../utils/music/tic80Music";
import {formatSeconds} from "../../utils/utils";

export type Tic80EffectInsight = {
   code: string;
   summary: string;
   detail?: string;
   warning?: string;
};


function paramByte(x: number, y: number): number {
   return (x << 4) | y;
}

function formatSigned(value: number): string {
   return value > 0 ? `+${value}` : value.toString();
}

function appendWarning(current: string|undefined, next: string): string {
   return current ? `${current} ${next}` : next;
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
         //detail
      };
   }

   // TIC-80 deliberately uses a two-step [0, x] sequence when y is zero.
   const offsets = y === 0 ? [0, x] : [0, x, y];
   if (baseMidiNote === undefined) {
      const offsetLabels = offsets.map(offset => offset === 0 ? "root" : `+${offset}`);
      return {
         code,
         summary: "Arpeggio",
         detail: offsetLabels.join(` `),
         warning: "No known base note",
      };
   }

   const noteLabels = offsets.map((offset) => {
      const note = baseMidiNote + offset;
      return formatTicMidiNote(note);
   });
   return {
      code,
      summary: "Arpeggio",
      detail: noteLabels.join(` `),
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
         insight = {
            code,
            summary: "Master volume",
            detail: `L ${x}/15, R ${y}/15`,
         };
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
         const ticks = paramByte(x, y);
         const duration = formatTic80Timing(ticks, timing);
         if (ticks === 0) {
            insight = {code, summary: "Slide off"};
         } else if (
            context?.activeBeforeRow !== undefined &&
            cell.midiNote !== undefined &&
            !cell.noteOff
         ) {
            insight = {
               code,
               summary: "Slide",
               detail: `${formatTicMidiNote(context.activeBeforeRow.midiNote)} to ${formatTicMidiNote(cell.midiNote)} over ${duration}`,
            };
         } else {
            insight = {code, summary: "Slide", detail: `duration ${duration}`};
         }
         break;
      }

      case kTic80EffectCommand.key.P: {
         const offset = paramByte(x, y) - 0x80;
         insight =
            {code, summary: "Pitch", detail: `offset ${formatSigned(offset)}`};
         break;
      }

      case kTic80EffectCommand.key.V:
         insight = x === 0 || y === 0 ?
            {code, summary: "Vibrato off"} :
            {code, summary: "Vibrato", detail: `${x * 2}-tick cycle, depth ${y}`};
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
