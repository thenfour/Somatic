import {CoalesceBoolean} from "../utils/utils";
import {Tic80Caps, Tic80ChannelIndex} from "./tic80Capabilities";

const clamp = (val: number, min: number, max: number) => Math.min(Math.max(val, min), max);

export class EditorState {
   octave: number;
   patternIndex: number;
   selectedPosition: number;
   currentInstrument: number;
   editingEnabled: boolean;
   patternEditRow: number;
   patternEditChannel: number;

   constructor({
      octave = Math.floor(Tic80Caps.pattern.octaveCount / 2),
      patternIndex: pattern = 0,
      selectedPosition = 0,
      currentInstrument = 1,
      editingEnabled = true,
      patternEditRow = 0,
      patternEditChannel = 0
   }: Partial<EditorState> = {}) {
      this.octave = clamp(octave, 1, Tic80Caps.pattern.octaveCount);
      this.patternIndex = clamp(pattern, 0, Tic80Caps.pattern.count - 1);
      this.selectedPosition = clamp(selectedPosition, 0, 255);
      this.currentInstrument = clamp(currentInstrument, 1, Tic80Caps.sfx.count);
      this.editingEnabled = CoalesceBoolean(editingEnabled, true);
      this.patternEditRow = clamp(patternEditRow, 0, 63);
      this.patternEditChannel = clamp(patternEditChannel, 0, 3);
   }

   setOctave(nextOctave: number) {
      this.octave = clamp(nextOctave, 1, Tic80Caps.pattern.octaveCount);
   }

   setPattern(nextPattern: number) {
      this.patternIndex = clamp(nextPattern, 0, Tic80Caps.pattern.count - 1);
   }

   setSelectedPosition(nextPosition: number) {
      this.selectedPosition = clamp(nextPosition, 0, 255);
   }

   setCurrentInstrument(nextInstrument: number) {
      this.currentInstrument = clamp(nextInstrument, 1, Tic80Caps.sfx.count);
   }

   setEditingEnabled(enabled: boolean) {
      this.editingEnabled = Boolean(enabled);
   }

   setPatternEditTarget({rowIndex, channelIndex}: {rowIndex: number, channelIndex: Tic80ChannelIndex}) {
      this.patternEditRow = clamp(rowIndex, 0, Tic80Caps.pattern.maxRows - 1);
      this.patternEditChannel = channelIndex;
   }

   toData() {
      return {
         octave: this.octave,
         pattern: this.patternIndex,
         selectedPosition: this.selectedPosition,
         currentInstrument: this.currentInstrument,
         editingEnabled: this.editingEnabled,
         patternEditRow: this.patternEditRow,
         patternEditChannel: this.patternEditChannel,
      };
   }

   static fromData(data?: Partial<EditorState>) {
      return new EditorState(data || {});
   }

   clone() {
      return EditorState.fromData(this.toData());
   }
}
