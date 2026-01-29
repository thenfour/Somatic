import {LoopMode} from "../audio/backend";
import {SelectionRect2D} from "../hooks/useRectSelection2D";
import {clamp, CoalesceBoolean, numericRange, Rect2D} from "../utils/utils";
import {Pattern, PatternCell} from "./pattern";
import {Song} from "./song";

export interface EditorStateDto {
   octave: number;
   activeSongPosition: number;
   currentInstrument: number;
   editingEnabled: boolean;
   showSomaticColumns: boolean;
   patternEditRow: number;
   patternEditChannel: number;
   selectedArrangementPositions: Rect2D|null;
   patternSelection: Rect2D|null;
   mutedChannels: number[];
   soloedChannels: number[];
   loopMode: LoopMode;
   lastNonOffLoopMode: LoopMode;
}

export type SomaticEditorStateColumnType = "note"|"instrument"|"command"|"param"|"somaticCommand"|"somaticParam";

export class EditorState {
   octave: number;
   activeSongPosition: number;
   currentInstrument: number;
   editingEnabled: boolean;
   showSomaticColumns: boolean;
   patternEditRow: number;
   patternEditChannel: number;
   patternEditColumnType: SomaticEditorStateColumnType;
   selectedArrangementPositions: SelectionRect2D|null;
   patternSelection: SelectionRect2D|null;
   mutedChannels: Set<number> = new Set<number>();
   soloedChannels: Set<number> = new Set<number>();
   loopMode: LoopMode;
   lastNonOffLoopMode: LoopMode;

   constructor({
      octave = 4,
      activeSongPosition = 0,
      currentInstrument = 0,
      editingEnabled = false,
      showSomaticColumns = true,
      patternEditRow = 0,
      patternEditChannel = 0,
      selectedArrangementPositions = null,
      patternSelection = null,
      mutedChannels = [],
      soloedChannels = [],
      loopMode = "off",
      lastNonOffLoopMode = "pattern",
   }: Partial<EditorStateDto> = {}) {
      this.octave = octave;
      this.activeSongPosition = clamp(activeSongPosition, 0, 255);
      this.currentInstrument = currentInstrument;
      this.editingEnabled = CoalesceBoolean(editingEnabled, true);
      this.showSomaticColumns = CoalesceBoolean(showSomaticColumns, true);
      this.patternEditRow = clamp(patternEditRow, 0, 63);
      this.patternEditChannel = patternEditChannel;
      this.patternEditColumnType = "note"; // default
      this.selectedArrangementPositions =
         selectedArrangementPositions ? new SelectionRect2D(selectedArrangementPositions) : null;
      this.patternSelection = patternSelection ? new SelectionRect2D(patternSelection) : null;
      this.mutedChannels = new Set(mutedChannels);
      this.soloedChannels = new Set(soloedChannels);
      this.loopMode = loopMode as LoopMode;
      this.lastNonOffLoopMode = lastNonOffLoopMode;
   }

   setOctave(song: Song, nextOctave: number) {
      this.octave = clamp(nextOctave, song.subsystem.minEditorOctave, song.subsystem.maxEditorOctave);
   }

   setActiveSongPosition(song: Song, newPosition: number) {
      this.activeSongPosition = clamp(newPosition, 0, song.subsystem.maxSongOrder - 1);
   }

   setCurrentInstrument(song: Song, nextInstrument: number) {
      this.currentInstrument = clamp(nextInstrument, 0, song.subsystem.maxInstruments - 1);
   }

   setEditingEnabled(enabled: boolean) {
      this.editingEnabled = Boolean(enabled);
   }

   setShowSomaticColumns(enabled: boolean) {
      this.showSomaticColumns = Boolean(enabled);
      if (
         !this.showSomaticColumns &&
         (this.patternEditColumnType === "somaticCommand" || this.patternEditColumnType === "somaticParam")) {
         this.patternEditColumnType = "param";
      }
   }

   setPatternEditTarget({song, rowIndex, channelIndex}: {song: Song, rowIndex: number, channelIndex: number}) {
      this.patternEditRow = clamp(rowIndex, 0, song.rowsPerPattern - 1);
      this.patternEditChannel = channelIndex;
   }

   setPatternEditColumnType(columnType: SomaticEditorStateColumnType) {
      this.patternEditColumnType = columnType;
   }

   setArrangementSelection(positions: SelectionRect2D|null) {
      this.selectedArrangementPositions = positions;
   }

   setPatternSelection(selection: SelectionRect2D|null) {
      this.patternSelection = selection;
   }

   setLoopMode(mode: LoopMode) {
      if (mode !== "off") {
         this.lastNonOffLoopMode = mode;
      }
      this.loopMode = mode;
   }

   advancePatternEditRow(song: Song, step: number) {
      const maxRow = song.rowsPerPattern - 1;
      //const safeStep = clamp(step, -Tic80Caps.pattern.maxRows, Tic80Caps.pattern.maxRows);
      this.patternEditRow = clamp(this.patternEditRow + step, 0, maxRow);
   }

   getEditingPattern(song: Song): Pattern|null {
      const activeSongPosition = clamp(this.activeSongPosition, 0, song.songOrder.length - 1);
      const item = song.songOrder[activeSongPosition]!;
      return song.patterns[item.patternIndex] || null;
   }

   getEditingCell(song: Song): PatternCell|null {
      const pattern = this.getEditingPattern(song);
      if (!pattern) {
         return null;
      }
      const currentRow = pattern.getCell(this.patternEditChannel, this.patternEditRow);
      return currentRow;
   }

   isChannelExplicitlyMuted(channelIndex: number): boolean {
      return this.mutedChannels.has(channelIndex);
   }

   isChannelExplicitlySoloed(channelIndex: number): boolean {
      return this.soloedChannels.has(channelIndex);
   }

   setChannelSolo(channelIndex: number, soloed: boolean) {
      if (soloed) {
         this.soloedChannels.add(channelIndex);
      } else {
         this.soloedChannels.delete(channelIndex);
      }
   }

   setChannelMute(channelIndex: number, muted: boolean) {
      if (muted) {
         this.mutedChannels.add(channelIndex);
      } else {
         this.mutedChannels.delete(channelIndex);
      }
   }

   isChannelAudible(channelIndex: number): boolean {
      if (this.soloedChannels.size > 0) {
         return this.soloedChannels.has(channelIndex);
      }
      if (this.mutedChannels.size > 0) {
         return !this.mutedChannels.has(channelIndex);
      }
      return true;
   }

   getAudibleChannels(song: Song): Set<number> {
      const channelIndices = numericRange(0, song.subsystem.channelCount);
      return new Set(channelIndices.filter(ch => this.isChannelAudible(ch)));
   }

   // Returns a string signature representing the current audible channels state; deterministic hash-like.
   getAudibleChannelSignature(song: Song): string {
      const channelIndices = numericRange(0, song.subsystem.channelCount);
      return channelIndices.map(ch => this.isChannelAudible(ch) ? "1" : "0").join("");
   }

   isPatternChannelSelected(channelIndex: number): boolean {
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
         showSomaticColumns: this.showSomaticColumns,
         patternEditRow: this.patternEditRow,
         patternEditChannel: this.patternEditChannel,
         selectedArrangementPositions: this.selectedArrangementPositions ? this.selectedArrangementPositions.toData() :
                                                                           null,
         patternSelection: this.patternSelection ? this.patternSelection.toData() : null,
         mutedChannels: [...this.mutedChannels],
         soloedChannels: [...this.soloedChannels],
         loopMode: this.loopMode,
         lastNonOffLoopMode: this.lastNonOffLoopMode,
      };
   }

   static fromData(data: Partial<EditorStateDto> = {}): EditorState {
      return new EditorState(data || {});
   }

   clone() {
      return EditorState.fromData(this.toData());
   }
}
