import {clamp, CoalesceBoolean} from "../utils/utils";
import {Tic80Caps, Tic80ChannelIndex, ToTic80ChannelIndex} from "./tic80Capabilities";

export class EditorState {
   octave: number;
   activeSongPosition: number;
   currentInstrument: number;
   editingEnabled: boolean;
   patternEditRow: number;
   patternEditChannel: Tic80ChannelIndex;
   selectedArrangementPositions: number[];

   constructor({
      octave = Math.floor(Tic80Caps.pattern.octaveCount / 2),
      activeSongPosition = 0,
      currentInstrument = 2, // 0 = reserved, 1 = off
      editingEnabled = false,
      patternEditRow = 0,
      patternEditChannel = 0,
      selectedArrangementPositions = [],
   }: Partial<EditorState> = {}) {
      this.octave = clamp(octave, 1, Tic80Caps.pattern.octaveCount);
      this.activeSongPosition = clamp(activeSongPosition, 0, 255);
      this.currentInstrument = clamp(currentInstrument, 0, Tic80Caps.sfx.count - 1);
      this.editingEnabled = CoalesceBoolean(editingEnabled, true);
      this.patternEditRow = clamp(patternEditRow, 0, 63);
      this.patternEditChannel = ToTic80ChannelIndex(patternEditChannel);
      this.selectedArrangementPositions = [...selectedArrangementPositions];
   }

   setOctave(nextOctave: number) {
      this.octave = clamp(nextOctave, 1, Tic80Caps.pattern.octaveCount);
   }

   setActiveSongPosition(newPosition: number) {
      this.activeSongPosition = clamp(newPosition, 0, 255);
   }

   setCurrentInstrument(nextInstrument: number) {
      this.currentInstrument = clamp(nextInstrument, 0, Tic80Caps.sfx.count - 1);
   }

   setEditingEnabled(enabled: boolean) {
      this.editingEnabled = Boolean(enabled);
   }

   setPatternEditTarget({rowIndex, channelIndex}: {rowIndex: number, channelIndex: Tic80ChannelIndex}) {
      this.patternEditRow = clamp(rowIndex, 0, Tic80Caps.pattern.maxRows - 1);
      this.patternEditChannel = channelIndex;
   }

   setArrangementSelection(positions: number[]) {
      this.selectedArrangementPositions = [...positions];
   }

   advancePatternEditRow(step: number, rowsPerPattern: number = Tic80Caps.pattern.maxRows) {
      const maxRow = clamp(rowsPerPattern - 1, 0, Tic80Caps.pattern.maxRows - 1);
      const safeStep = clamp(step, -Tic80Caps.pattern.maxRows, Tic80Caps.pattern.maxRows);
      this.patternEditRow = clamp(this.patternEditRow + safeStep, 0, maxRow);
   }

   toData() {
      return {
         octave: this.octave,
         activeSongPosition: this.activeSongPosition,
         currentInstrument: this.currentInstrument,
         editingEnabled: this.editingEnabled,
         patternEditRow: this.patternEditRow,
         patternEditChannel: this.patternEditChannel,
         selectedArrangementPositions: [...this.selectedArrangementPositions],
      };
   }

   static fromData(data?: Partial<EditorState>) {
      return new EditorState(data || {});
   }

   clone() {
      return EditorState.fromData(this.toData());
   }
}
