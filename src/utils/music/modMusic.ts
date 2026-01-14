// ------------------------------------------------------------------------------------------------
// MOD / ProTracker periods

import {pow2} from "../utils";

// ProTracker playable note labels are originally C-1 .. B-3 (3 octaves = 36 notes).
// align those names with existing naming scheme where "C-1" means octave 1 (MIDI 24).
// note slides and finetune clamp to this range as well and players typically enforce it.
export const PROTRACKER_MIN_MIDI = 24;   // C-1 in your naming
export const PROTRACKER_NOTE_COUNT = 36; // C-1..B-3

// NOTE: OpenMPT calls "C-4" "C-7". Maybe it does this to avoid negative or 0 octave numbers?
// but i think Somatic is doing the right thing.

// The on-disk MOD period field is 12-bit (0 means "no note"). 1-4095 are valid period values.
// In practice, classic ProTracker modules use a smaller subset, but supporting the full range
// is useful for conversion/UI and for modules created by other trackers.
const MOD_PERIOD_MIN = 1;
const MOD_PERIOD_MAX = 0x0fff;

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

// Generate the canonical 16×36 ProTracker period table -- ported from
// https://resources.openmpt.org/documents/PTGenerator.c
//
// preserves ProTracker's quirks:
// - UST/AHRM superimposition for certain entries
// - octave doubling for the extended range
// - the manual mystery corrections

function getPTPeriod(note: number, tune: ProtrackerFinetune): number {
   // Port of PTGenerator.c / getPTPeriod(note=0..35, tune=-8..+7)
   const NTSC_CLK = 3579545.0;
   const REF_PERIOD_PT = 856.0;
   const REF_PERIOD_UST = NTSC_CLK / 523.3 / 8;

   // Convert note and tune into a more helpful representation
   const note2 = note + Math.floor((tune + 8) / 8);
   const tune2 = (tune + 8) & 7;

   // normalized period
   let period = pow2((-tune / 8.0) * (1.0 / 12.0));
   period *= pow2((-note) * (1.0 / 12.0));

   // Select between PT and UST for the wanted entry
   if (tune2 === 0 && note2 !== 0) {
      period *= REF_PERIOD_UST;

      // Equivalent of taking resulting entry "period/2" and multiplying by 2 for periods above 508
      if (note2 < 10) {
         period = Math.floor((period + 1.0) / 2.0) * 2.0;
      }
   } else {
      period *= REF_PERIOD_PT;

      // Manual correction of the "evil nine"
      if (tune === -7 && note === 6)
         period -= 1;
      if (tune === -7 && note === 26)
         period -= 1;
      if (tune === -4 && note === 34)
         period -= 1;
      if (tune === 1 && note === 4)
         period -= 1;
      if (tune === 1 && note === 22)
         period += 1;
      if (tune === 1 && note === 24)
         period += 1;
      if (tune === 2 && note === 23)
         period += 1;
      if (tune === 4 && note === 9)
         period += 1;
      if (tune === 7 && note === 24)
         period += 1;
   }

   return Math.floor(period + 0.5);
}

function generateProtrackerPeriodTablesOpenMPT(): ReadonlyArray<ReadonlyArray<number>> {
   const tables: number[][] = [];
   for (const ft of MOD_FINETUNES) {
      const row: number[] = new Array(PROTRACKER_NOTE_COUNT);
      for (let note = 0; note < PROTRACKER_NOTE_COUNT; note++) {
         row[note] = getPTPeriod(note, ft);
      }
      tables.push(row);
   }
   return Object.freeze(tables.map((r) => Object.freeze(r.slice())));
}

export const PROTRACKER_PERIOD_TABLES = generateProtrackerPeriodTablesOpenMPT();

// Fast lookup maps built once:
// - midi -> period (array indexed by midi, may be undefined if out of representable range)
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

   // ProTracker's canonical table covers 36 notes (C-1..B-3), but the "period" concept itself
   // naturally extends across octaves by halving/doubling. We extend by taking the first octave
   // (C-1..B-1) as a base and applying exact octave scaling.
   //
   // This keeps the original table values for the canonical range, and provides reasonable
   // values outside it. (There is no single universally-correct "ProTracker" table outside
   // the classic 3-octave range.)
   const baseOctaveSemitones = 12;
   const basePeriodsC1ToB1 = table.slice(0, baseOctaveSemitones);

   for (let midi = 0; midi < 256; midi++) {
      const delta = midi - PROTRACKER_MIN_MIDI;
      // For negative numbers, JS % keeps the sign; normalize to 0..11.
      const semitone = ((delta % 12) + 12) % 12;
      const octaveOffset = Math.floor(delta / 12);

      const p0 = basePeriodsC1ToB1[semitone];
      if (p0 === undefined) {
         continue;
      }

      const scale = 2 ** (-octaveOffset);
      const period = (p0 * scale + 0.5) | 0;

      if (period < MOD_PERIOD_MIN || period > MOD_PERIOD_MAX) {
         continue;
      }

      periodByMidi[midi] = period;
      // Avoid unstable overwrites if rounding collisions happen.
      if (!midiByPeriod.has(period)) {
         midiByPeriod.set(period, midi);
      }
   }

   // dump for verification
   //console.log(`ProTracker finetune ${ft} lookup:`);
   //console.table(periodByMidi.map((p, midi) => p !== undefined ? {midi, period: p} : null).filter((x) => x !== null));

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
      midi?: number; // if undefined, no possible match. otherwise it can be nearest or exact.
      //nearestName?: NoteName //
   }>;

// Decode a MOD period value with given finetune into either:
// - exact table match (kind="table")
// - raw unmatched value with optional nearest table note (kind="raw")
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
      midi: bestMidi,
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
