// ------------------------------------------------------------------------------------------------
// MOD / ProTracker periods

// ProTracker playable note labels are commonly C-1 .. B-3 (3 octaves = 36 notes).
// align those names with existing naming scheme where "C-1" means octave 1 (MIDI 24).
export const PROTRACKER_MIN_MIDI = 24;   // C-1 in your naming
export const PROTRACKER_NOTE_COUNT = 36; // C-1..B-3

// Base (finetune=0) period table for C-1..B-3.
// This is the canonical set most players/builders start from.
export const PROTRACKER_BASE_PERIODS_FT0: readonly number[] = Object.freeze([
   // clang-format off
      // C-1 .. B-1
      856, 808, 762, 720, 678, 640, 604, 570, 538, 508, 480, 453,
      // C-2 .. B-2
      428, 404, 381, 360, 339, 320, 302, 285, 269, 254, 240, 226,
      // C-3 .. B-3
      214, 202, 190, 180, 170, 160, 151, 143, 135, 127, 120, 113,
   // clang-format on
]);

export type ProtrackerFinetune = -8|- 7|- 6|- 5|- 4|- 3|- 2|- 1|0|1|2|3|4|5|6|7;

export const MOD_FINETUNES: readonly ProtrackerFinetune[] = Object.freeze([
   // clang-format off
    -8, -7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7,
   // clang-format on
]);

// Convert finetune value to index 0..15 for table lookup.
export function protrackerFinetuneIndex(ft: ProtrackerFinetune): number {
   return ft + 8; // -8..7 -> 0..15
}

// Generate period tables for finetune -8..+7.
// We use the standard scaling: period * 2^(-ft / (12*8)) == period * 2^(-ft/96),
// then round to nearest int.
//
// Note: some historical tables differ by ±1 on a couple of entries depending on rounding quirks.
// For *stable editing*, you’ll preserve raw periods on import when not an exact table hit,
// and only quantize to table values when the user explicitly enters/edits notes.
function generateFinetuneTables(): ReadonlyArray<ReadonlyArray<number>> {
   const tables: number[][] = [];
   for (const ft of MOD_FINETUNES) {
      const mul = 2 ** (-ft / 96);
      const row: number[] = new Array(PROTRACKER_NOTE_COUNT);
      for (let i = 0; i < PROTRACKER_NOTE_COUNT; i++) {
         const p0 = PROTRACKER_BASE_PERIODS_FT0[i];
         row[i] = (p0 * mul + 0.5) | 0; // fast round-to-nearest int
      }
      tables.push(row);
   }
   return Object.freeze(tables.map((r) => r.slice()));
}

export const PROTRACKER_PERIOD_TABLES = generateFinetuneTables();

// Fast lookup maps built once:
// - midi -> period (array indexed by midi, sparse outside C-1..B-3)
// - period -> midi (Map for exact match)
type ProtrackerLookup = Readonly<{
   periodByMidi: ReadonlyArray<number|undefined>; // length 256
   midiByPeriod: ReadonlyMap<number, number>;
}>;

function buildLookupsForFinetune(ft: ProtrackerFinetune): ProtrackerLookup {
   const idx = protrackerFinetuneIndex(ft);
   const table = PROTRACKER_PERIOD_TABLES[idx];

   const periodByMidi: Array<number|undefined> = new Array(256).fill(undefined);
   const midiByPeriod = new Map<number, number>();

   for (let i = 0; i < PROTRACKER_NOTE_COUNT; i++) {
      const midi = PROTRACKER_MIN_MIDI + i;
      const period = table[i];
      periodByMidi[midi] = period;
      midiByPeriod.set(period, midi);
   }

   return Object.freeze({
      periodByMidi: Object.freeze(periodByMidi),
      midiByPeriod: midiByPeriod,
   });
}

const PROTRACKER_LOOKUPS: ReadonlyArray<ProtrackerLookup> = Object.freeze(
   MOD_FINETUNES.map((ft) => buildLookupsForFinetune(ft)),
);

export type ModDecodedPitch = //
   |Readonly<{
      //
      kind: "table"; //
      finetune: ProtrackerFinetune;
      midi: number; //
      //name: NoteName;
      period: number
   }>|Readonly<{
      //
      kind: "raw"; //
      finetune: ProtrackerFinetune;
      period: number;
      nearestMidi?: number; //
      //nearestName?: NoteName //
   }>;

export function decodeModPeriod(period: number, finetune: ProtrackerFinetune): ModDecodedPitch {
   const lk = PROTRACKER_LOOKUPS[protrackerFinetuneIndex(finetune)];
   const midi = lk.midiByPeriod.get(period);
   if (midi !== undefined) {
      return Object.freeze({kind: "table", finetune, midi, period});
   }

   // Optional nearest for UI display only (do not quantize!)
   let bestMidi: number|undefined;
   let bestDist = Number.POSITIVE_INFINITY;
   for (const [p, m] of lk.midiByPeriod.entries()) {
      const d = Math.abs(p - period);
      if (d < bestDist) {
         bestDist = d;
         bestMidi = m;
      }
   }
   return Object.freeze({
      kind: "raw",
      finetune,
      period,
      nearestMidi: bestMidi,
      //nearestName: bestMidi !== undefined ? nameOf(bestMidi) : undefined,
   });
}

export function modPeriodFromMidi(midi: number, finetune: ProtrackerFinetune): number|undefined {
   if (!Number.isFinite(midi))
      return undefined;
   midi = midi | 0;
   if (midi < 0 || midi > 255)
      return undefined;
   const lk = PROTRACKER_LOOKUPS[protrackerFinetuneIndex(finetune)];
   return lk.periodByMidi[midi];
}

export function modMidiFromPeriod(period: number, finetune: ProtrackerFinetune): number|undefined {
   const lk = PROTRACKER_LOOKUPS[protrackerFinetuneIndex(finetune)];
   return lk.midiByPeriod.get(period);
}
