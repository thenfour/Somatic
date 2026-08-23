import {PATTERN_SIDE_CHANNEL_MAX_LENGTH} from "../models/pattern";

export type SideChannelCellTextSanitization = {
   value: string;
   removedLineBreaks: boolean;
   removedUnsupportedCharacters: boolean;
   wasTruncated: boolean;
};

export type SideChannelPlaintextAdjustments = {
   removedLineBreaks: boolean;
   removedUnsupportedCharacters: boolean;
   truncatedCellCount: number;
   droppedRowCount: number;
};

export type SerializedSideChannelPlaintext = {
   text: string;
   adjustments: SideChannelPlaintextAdjustments;
};

export type ParsedSideChannelPlaintext = {
   values: string[];
   adjustments: SideChannelPlaintextAdjustments;
};

const emptyAdjustments = (): SideChannelPlaintextAdjustments => ({
   removedLineBreaks: false,
   removedUnsupportedCharacters: false,
   truncatedCellCount: 0,
   droppedRowCount: 0,
});

// A side-channel value is one pattern cell, so line breaks are deliberately not
// part of its value. They remain available as the row delimiter in the plain-text
// clipboard format.
export function sanitizeSideChannelCellText(
   value: string,
   maxLength = PATTERN_SIDE_CHANNEL_MAX_LENGTH,
): SideChannelCellTextSanitization {
   let filtered = "";
   let removedLineBreaks = false;
   let removedUnsupportedCharacters = false;

   for (const char of value) {
      if (char === "\r" || char === "\n") {
         removedLineBreaks = true;
         continue;
      }

      const codePoint = char.codePointAt(0) ?? 0;
      if (codePoint < 0x20 || codePoint > 0x7e) {
         removedUnsupportedCharacters = true;
         continue;
      }

      filtered += char;
   }

   const safeMaxLength = Math.max(0, Math.trunc(maxLength));
   return {
      value: filtered.slice(0, safeMaxLength),
      removedLineBreaks,
      removedUnsupportedCharacters,
      wasTruncated: filtered.length > safeMaxLength,
   };
}

export function serializeSideChannelPlaintext(values: readonly string[]): SerializedSideChannelPlaintext {
   const adjustments = emptyAdjustments();
   const sanitizedValues = values.map((value) => {
      const sanitized = sanitizeSideChannelCellText(value);
      adjustments.removedLineBreaks ||= sanitized.removedLineBreaks;
      adjustments.removedUnsupportedCharacters ||= sanitized.removedUnsupportedCharacters;
      adjustments.truncatedCellCount += sanitized.wasTruncated ? 1 : 0;
      return sanitized.value;
   });

   return {
      text: sanitizedValues.join("\n"),
      adjustments,
   };
}

export function parseSideChannelPlaintext(text: string, maxRows: number): ParsedSideChannelPlaintext {
   // Normalize all common clipboard line endings before splitting. String.split
   // deliberately preserves a trailing empty item, so "value\n" is two rows.
   const rows = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
   const safeMaxRows = Math.max(0, Math.trunc(maxRows));
   const adjustments = emptyAdjustments();
   adjustments.droppedRowCount = Math.max(0, rows.length - safeMaxRows);

   const values = rows.slice(0, safeMaxRows).map((value) => {
      const sanitized = sanitizeSideChannelCellText(value);
      adjustments.removedUnsupportedCharacters ||= sanitized.removedUnsupportedCharacters;
      adjustments.truncatedCellCount += sanitized.wasTruncated ? 1 : 0;
      return sanitized.value;
   });

   return {values, adjustments};
}

export function describeSideChannelPlaintextAdjustments(
   adjustments: SideChannelPlaintextAdjustments,
): string | null {
   const changes: string[] = [];
   if (adjustments.removedLineBreaks) changes.push("removed line breaks");
   if (adjustments.removedUnsupportedCharacters) changes.push("removed unsupported characters");
   if (adjustments.truncatedCellCount > 0) {
      changes.push(
         `truncated ${adjustments.truncatedCellCount} ${adjustments.truncatedCellCount === 1 ? "cell" : "cells"} to fit the ${PATTERN_SIDE_CHANNEL_MAX_LENGTH}-character limit`,
      );
   }
   if (adjustments.droppedRowCount > 0) {
      changes.push(
         `ignored ${adjustments.droppedRowCount} ${adjustments.droppedRowCount === 1 ? "row" : "rows"} that did not fit`,
      );
   }

   if (changes.length === 0) return null;
   return changes.join(", ");
}
