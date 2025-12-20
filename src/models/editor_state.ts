import {SelectionRect2D} from "../hooks/useRectSelection2D";
import {clamp, CoalesceBoolean, Rect2D} from "../utils/utils";
import {Pattern, PatternCell} from "./pattern";
import {Song} from "./song";
import {gChannelsArray, Tic80Caps, Tic80ChannelIndex, ToTic80ChannelIndex} from "./tic80Capabilities";

// export type PatternSelectionDto = {
//    startRow: number;     //
//    rowCount: number;     //
//    startChannel: number; //
//    channelCount: number; //
// };

export interface EditorStateDto {
   octave: number;
   activeSongPosition: number;
   currentInstrument: number;
   editingEnabled: boolean;
   patternEditRow: number;
   patternEditChannel: Tic80ChannelIndex;
   selectedArrangementPositions: Rect2D|null;
   patternSelection: Rect2D|null;
   mutedChannels: Tic80ChannelIndex[];
   soloedChannels: Tic80ChannelIndex[];
}
;

export class EditorState {
   octave: number;
   activeSongPosition: number;
   currentInstrument: number;
   editingEnabled: boolean;
   patternEditRow: number;
   patternEditChannel: Tic80ChannelIndex;
   selectedArrangementPositions: SelectionRect2D|null;
   patternSelection: SelectionRect2D|null;
   mutedChannels: Set<Tic80ChannelIndex> = new Set<Tic80ChannelIndex>();
   soloedChannels: Set<Tic80ChannelIndex> = new Set<Tic80ChannelIndex>();

   constructor({
      octave = Math.floor(Tic80Caps.pattern.octaveCount / 2),
      activeSongPosition = 0,
      currentInstrument = 2, // 0 = reserved, 1 = off
      editingEnabled = false,
      patternEditRow = 0,
      patternEditChannel = 0,
      selectedArrangementPositions = null,
      patternSelection = null,
      mutedChannels = [],
      soloedChannels = [],
   }: Partial<EditorStateDto> = {}) {
      this.octave = clamp(octave, 1, Tic80Caps.pattern.octaveCount);
      this.activeSongPosition = clamp(activeSongPosition, 0, 255);
      this.currentInstrument = clamp(currentInstrument, 0, Tic80Caps.sfx.count - 1);
      this.editingEnabled = CoalesceBoolean(editingEnabled, true);
      this.patternEditRow = clamp(patternEditRow, 0, 63);
      this.patternEditChannel = ToTic80ChannelIndex(patternEditChannel);
      this.selectedArrangementPositions =
         selectedArrangementPositions ? new SelectionRect2D(selectedArrangementPositions) : null;
      this.patternSelection = patternSelection ? new SelectionRect2D(patternSelection) : null;
      this.mutedChannels = new Set(mutedChannels);
      this.soloedChannels = new Set(soloedChannels);
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

   setArrangementSelection(positions: SelectionRect2D|null) {
      this.selectedArrangementPositions = positions;
   }

   setPatternSelection(selection: SelectionRect2D|null) {
      this.patternSelection = selection;
   }

   advancePatternEditRow(step: number, rowsPerPattern: number = Tic80Caps.pattern.maxRows) {
      const maxRow = clamp(rowsPerPattern - 1, 0, Tic80Caps.pattern.maxRows - 1);
      const safeStep = clamp(step, -Tic80Caps.pattern.maxRows, Tic80Caps.pattern.maxRows);
      this.patternEditRow = clamp(this.patternEditRow + safeStep, 0, maxRow);
   }

   getEditingPattern(song: Song): Pattern {
      const activeSongPosition = clamp(this.activeSongPosition, 0, song.songOrder.length - 1);
      const patternId = song.songOrder[activeSongPosition]!;
      return song.patterns[patternId]!;
   }

   getEditingCell(song: Song): PatternCell {
      const pattern = this.getEditingPattern(song);
      const currentRow = pattern.getCell(this.patternEditChannel, this.patternEditRow);
      return currentRow;
   }

   isChannelExplicitlyMuted(channelIndex: Tic80ChannelIndex): boolean {
      return this.mutedChannels.has(channelIndex);
   }

   isChannelExplicitlySoloed(channelIndex: Tic80ChannelIndex): boolean {
      return this.soloedChannels.has(channelIndex);
   }

   setChannelSolo(channelIndex: Tic80ChannelIndex, soloed: boolean) {
      if (soloed) {
         this.soloedChannels.add(channelIndex);
      } else {
         this.soloedChannels.delete(channelIndex);
      }
   }

   setChannelMute(channelIndex: Tic80ChannelIndex, muted: boolean) {
      if (muted) {
         this.mutedChannels.add(channelIndex);
      } else {
         this.mutedChannels.delete(channelIndex);
      }
   }

   isChannelAudible(channelIndex: Tic80ChannelIndex): boolean {
      if (this.soloedChannels.size > 0) {
         return this.soloedChannels.has(channelIndex);
      }
      if (this.mutedChannels.size > 0) {
         return !this.mutedChannels.has(channelIndex);
      }
      return true;
   }

   getAudibleChannels(): Set<Tic80ChannelIndex> {
      return new Set(gChannelsArray.filter(ch => this.isChannelAudible(ch)));
   }

   // Returns a string signature representing the current audible channels state; deterministic hash-like.
   getAudibleChannelSignature(): string {
      return gChannelsArray.map(ch => this.isChannelAudible(ch) ? "1" : "0").join("");
   }

   isPatternChannelSelected(channelIndex: Tic80ChannelIndex): boolean {
      if (!this.patternSelection) {
         return false;
      }
      return this.patternSelection.includesX(channelIndex);
   }

   isPatternRowSelected(rowIndex: number): boolean {
      if (!this.patternSelection) {
         return false;
      }
      return this.patternSelection.includesY(rowIndex);
   }

   toData(): EditorStateDto {
      return {
         octave: this.octave,
         activeSongPosition: this.activeSongPosition,
         currentInstrument: this.currentInstrument,
         editingEnabled: this.editingEnabled,
         patternEditRow: this.patternEditRow,
         patternEditChannel: this.patternEditChannel,
         selectedArrangementPositions: this.selectedArrangementPositions ? this.selectedArrangementPositions.toData() :
                                                                           null,
         patternSelection: this.patternSelection ? this.patternSelection.toData() : null,
         mutedChannels: [...this.mutedChannels],
         soloedChannels: [...this.soloedChannels],
      };
   }

   static fromData(data: Partial<EditorStateDto> = {}): EditorState {
      return new EditorState(data || {});
   }

   clone() {
      return EditorState.fromData(this.toData());
   }
}
