import React from "react";

import type {Song, SongChannelNoteOccurrence} from "../models/song";
import {
   kSomaticPatternCommand,
   kTic80EffectCommand,
   type SomaticPatternCommand,
   type Tic80EffectCommand,
} from "../models/tic80Capabilities";
import {
   getTic80SongStateAccumulator,
   type SomaticCommandState,
   type Tic80EffectCommandState,
   type Tic80SongChannelState,
} from "../subsystem/tic80/tic80_song_state";
import {formatMidiNoteFixedWidth} from "../utils/music/noteRegistry";
import {Tooltip} from "./basic/tooltip";
import {formatByte, formatNibble} from "../utils/utils";

type PatternRowStateTooltipContentProps = Readonly<{
   song: Song;
   songPosition: number;
   rowIndex: number;
}>;

export type PatternRowChannelStateDisplay = Readonly<{
   channelNumber: number;
   note: string;
   instrument: string;
   effects: string;
}>;

export type PatternRowStateDisplay = Readonly<{
   rowReachable: boolean;
   channels: readonly PatternRowChannelStateDisplay[];
}>;

function formatTic80Effect(
   command: Tic80EffectCommand,
   state: Tic80EffectCommandState,
): string {
   const commandChar = kTic80EffectCommand.infoByKey[command].patternChar;
   return `${commandChar}${formatNibble(state.effectX)}${formatNibble(state.effectY)}`;
}

function formatSomaticEffect(
   command: SomaticPatternCommand,
   state: SomaticCommandState,
): string {
   const commandChar = kSomaticPatternCommand.infoByKey[command].patternChar;
   return `${commandChar}${formatByte(state.paramU8)}`;
}

function formatEffectState(channelState: Tic80SongChannelState): string {
   const entries: string[] = [];
   for (const command of kTic80EffectCommand.keys) {
      const state = channelState.tic80EffectCommandStates.get(command);
      if (state)
         entries.push(formatTic80Effect(command, state));
   }
   for (const command of kSomaticPatternCommand.keys) {
      const state = channelState.somaticCommandStates.get(command);
      if (state)
         entries.push(formatSomaticEffect(command, state));
   }
   return entries.join(" ");
}

function getActiveInstrumentIndex(
   song: Song,
   channelIndex: number,
   activeNote: SongChannelNoteOccurrence | undefined,
): number | undefined {
   if (!activeNote)
      return undefined;
   const patternIndex = song.songOrder[activeNote.songPosition]?.patternIndex;
   if (patternIndex === undefined)
      return undefined;
   return song.patterns[patternIndex]?.peekCell(channelIndex, activeNote.rowIndex)?.instrumentIndex;
}

export function getPatternRowStateDisplay(
   song: Song,
   songPosition: number,
   rowIndex: number,
): PatternRowStateDisplay {
   const rowState = getTic80SongStateAccumulator(song).getRowState(songPosition, rowIndex);
   return {
      rowReachable: rowState.rowReachable,
      channels: rowState.afterRow.map((channelState, channelIndex) => {
         const activeNote = channelState.activeNote;
         const instrumentIndex = getActiveInstrumentIndex(song, channelIndex, activeNote);
         return {
            channelNumber: channelIndex + 1,
            note: activeNote ? formatMidiNoteFixedWidth(activeNote.midiNote) : "---",
            instrument: instrumentIndex === undefined ? "--" : formatByte(instrumentIndex),
            effects: formatEffectState(channelState) || "--",
         };
      }),
   };
}

// Tooltip mounts its title subtree only while open. Keep the row-state query and
// all display formatting here so closed pattern rows do no snapshot work.
const PatternRowStateTooltipContent = React.memo<PatternRowStateTooltipContentProps>(
   ({song, songPosition, rowIndex}) => {
      const display = getPatternRowStateDisplay(song, songPosition, rowIndex);

      return (
         <div className="pattern-row-state-tooltip-content">
            <div className="pattern-row-state-tooltip-title">
               State after row {rowIndex.toString().padStart(2, "0")}
               {!display.rowReachable && " (not reached during playback)"}
            </div>
            <table className="pattern-row-state-tooltip-table">
               <thead>
                  <tr>
                     <th>Ch</th>
                     <th>Note</th>
                     <th>Inst</th>
                     <th>Effects</th>
                  </tr>
               </thead>
               <tbody>
                  {display.channels.map((channel) => (
                     <tr key={channel.channelNumber}>
                        <th>{channel.channelNumber}</th>
                        <td>{channel.note}</td>
                        <td>{channel.instrument}</td>
                        <td>{channel.effects}</td>
                     </tr>
                  ))}
               </tbody>
            </table>
         </div>
      );
   },
);

type PatternRowStateTooltipProps = PatternRowStateTooltipContentProps & Readonly<{
   children: React.ReactElement;
}>;

export const PatternRowStateTooltip: React.FC<PatternRowStateTooltipProps> = ({
   song,
   songPosition,
   rowIndex,
   children,
}) => (
   <Tooltip
      title={(
         <PatternRowStateTooltipContent
            song={song}
            songPosition={songPosition}
            rowIndex={rowIndex}
         />
      )}
   >
      {children}
   </Tooltip>
);
