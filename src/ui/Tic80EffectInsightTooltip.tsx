import React from "react";

import type {PatternCell} from "../models/pattern";
import type {Song} from "../models/song";
import {kTic80EffectCommand} from "../models/tic80Capabilities";
import {
   describeTic80Effect,
   type Tic80EffectInsight,
} from "../subsystem/tic80/tic80_effect_insight";
import {Tooltip} from "./basic/tooltip";
import "./Tic80EffectInsightTooltip.css";

type PrecomputedInsightSource = Readonly<{
   kind: "precomputed";
   insight: Tic80EffectInsight;
}>;

type SongRowInsightSource = Readonly<{
   kind: "song-row";
   song: Song;
   cell: PatternCell;
   songPosition: number;
   channelIndex: number;
   rowIndex: number;
}>;

export type Tic80EffectInsightSource = PrecomputedInsightSource | SongRowInsightSource;

type Tic80EffectInsightTooltipContentProps = Readonly<{
   source: Tic80EffectInsightSource;
}>;

// Tooltip mounts its title subtree only while open. Keep the song-state lookup
// and insight calculation inside this child so closed pattern cells stay cheap.
const Tic80EffectInsightTooltipContent = React.memo<Tic80EffectInsightTooltipContentProps>(
   ({source}) => {
      const insight = source.kind === "precomputed"
         ? source.insight
         : describeTic80Effect(
            source.cell,
            source.song.getChannelNoteContext(
               source.songPosition,
               source.channelIndex,
               source.rowIndex,
            ),
            {tempo: source.song.tempo, speed: source.song.speed},
         );
      if (!insight)
         return null;

      return <div className="effect-insight-tooltip-content">
         <div className="effect-insight-code">{insight.code}: {insight.summary}</div>
         <div className="effect-insight-detail">{insight.detail}</div>
         <div className="effect-insight-explanation">{insight.explanation}</div>
         <div className="effect-insight-warning">{insight.warning}</div>
      </div>;
   },
);

type Tic80EffectInsightTooltipProps = Readonly<{
   source: Tic80EffectInsightSource;
   children: React.ReactElement;
   showInStatusBar?: boolean;
}>;

export const Tic80EffectInsightTooltip: React.FC<Tic80EffectInsightTooltipProps> = ({
   source,
   children,
}) => {
   // if precomputed, disable if no insight.
   // if not precomputed, disable if the tic80 effect is not valid (e.g. empty cell).
   const disabled = source.kind === "precomputed"
      ? !source.insight
      : !kTic80EffectCommand.isValidKey(source.cell.tic80Effect);

   return (
      <Tooltip
         disabled={disabled}
         title={(
            <Tic80EffectInsightTooltipContent
               source={source}
            />
         )}
      >
         {children}
      </Tooltip>
   );
};
