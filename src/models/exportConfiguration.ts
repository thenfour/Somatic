import {MorphEntryFieldNamesToRename} from "../../bridge/morphSchema";
import {OptimizationRuleOptions} from "../utils/lua/lua_processor";
import {CoalesceBoolean} from "../utils/utils";

export const CueSheetFieldValues = ["pi", "beat", "ms", "rows", "icon", "note"] as const;
export type CueSheetField = typeof CueSheetFieldValues[number];

export const kDefaultReleaseMinificationOptions: OptimizationRuleOptions = {
   stripComments: true,
   stripDebugBlocks: true,
   maxIndentLevel: 1,
   lineBehavior: "tight",
   maxLineLength: 180,
   aliasRepeatedExpressions: true,
   renameLocalVariables: true,
   aliasLiterals: true,
   packLocalDeclarations: true,
   simplifyExpressions: true,
   removeUnusedLocals: true,
   removeUnusedFunctions: false,
   functionNamesToKeep: [],
   renameTableFields: true,
   tableEntryKeysToRename: [...MorphEntryFieldNamesToRename],
} as const;

export const kDefaultDebugMinificationOptions: OptimizationRuleOptions = {
   stripComments: false,
   stripDebugBlocks: false,
   maxIndentLevel: 50,
   lineBehavior: "pretty",
   maxLineLength: 120,
   aliasRepeatedExpressions: false,
   renameLocalVariables: false,
   aliasLiterals: false,
   packLocalDeclarations: false,
   simplifyExpressions: false,
   removeUnusedLocals: false,
   removeUnusedFunctions: false,
   functionNamesToKeep: [],
   renameTableFields: false,
   tableEntryKeysToRename: [],
} as const;

function cloneMinificationOptions(options: OptimizationRuleOptions): OptimizationRuleOptions {
   return {
      ...options,
      functionNamesToKeep: [...options.functionNamesToKeep],
      tableEntryKeysToRename: [...options.tableEntryKeysToRename],
   };
}

function normalizeCueSheetFields(fields: unknown): CueSheetField[] {
   if (!Array.isArray(fields)) {
      return [...CueSheetFieldValues];
   }

   const selectedFields = new Set(fields);
   return CueSheetFieldValues.filter((field) => selectedFields.has(field));
}

export type ExportConfigurationDto = {
   name: string;
   minificationOptions: OptimizationRuleOptions;

   // Replaces the BEGIN_CUSTOM_ENTRYPOINT block in the exported playroutine.
   useCustomEntrypointLua: boolean;
   customEntrypointLua: string;

   exportCueSheet: boolean;
   cueSheetFields: CueSheetField[];
};

export function isValidExportConfigurationName(name: string): boolean {
   return name.trim().length > 0;
}

export class ExportConfiguration {
   private _name: string;
   minificationOptions: OptimizationRuleOptions;
   useCustomEntrypointLua: boolean;
   customEntrypointLua: string;
   exportCueSheet: boolean;
   cueSheetFields: CueSheetField[];

   constructor(data: Partial<ExportConfigurationDto> = {}) {
      this._name = typeof data.name === "string" && isValidExportConfigurationName(data.name)
         ? data.name
         : "Export configuration";
      this.minificationOptions = cloneMinificationOptions(
         data.minificationOptions ?? kDefaultReleaseMinificationOptions,
      );
      this.useCustomEntrypointLua = CoalesceBoolean(data.useCustomEntrypointLua, false);
      this.customEntrypointLua = typeof data.customEntrypointLua === "string" ? data.customEntrypointLua : "";
      this.exportCueSheet = CoalesceBoolean(data.exportCueSheet, true);
      this.cueSheetFields = normalizeCueSheetFields(data.cueSheetFields);
   }

   get name(): string {
      return this._name;
   }

   set name(value: string) {
      if (!isValidExportConfigurationName(value)) {
         throw new Error("Export configuration name must contain at least one non-whitespace character.");
      }
      this._name = value;
   }

   setMinificationOptions(options: OptimizationRuleOptions): void {
      this.minificationOptions = cloneMinificationOptions(options);
   }

   setCueSheetFieldEnabled(field: CueSheetField, enabled: boolean): void {
      const selectedFields = new Set(this.cueSheetFields);
      if (enabled) {
         selectedFields.add(field);
      } else {
         selectedFields.delete(field);
      }
      this.cueSheetFields = CueSheetFieldValues.filter((candidate) => selectedFields.has(candidate));
   }

   toData(): ExportConfigurationDto {
      return {
         name: this.name,
         minificationOptions: cloneMinificationOptions(this.minificationOptions),
         useCustomEntrypointLua: this.useCustomEntrypointLua,
         customEntrypointLua: this.customEntrypointLua,
         exportCueSheet: this.exportCueSheet,
         cueSheetFields: [...this.cueSheetFields],
      };
   }
}

export const ExportConfigurationClipboardType = "somatic-export-configuration";

export type ExportConfigurationClipboardPayload = {
   type: typeof ExportConfigurationClipboardType;
   version: 1;
   configuration: ExportConfigurationDto;
};

export function createExportConfigurationClipboardPayload(
   configuration: ExportConfiguration,
): ExportConfigurationClipboardPayload {
   return {
      type: ExportConfigurationClipboardType,
      version: 1,
      configuration: configuration.toData(),
   };
}

function isOptimizationRuleOptions(value: unknown): value is OptimizationRuleOptions {
   if (!value || typeof value !== "object") return false;
   const options = value as Partial<OptimizationRuleOptions>;
   const booleanKeys: (keyof OptimizationRuleOptions)[] = [
      "stripComments",
      "stripDebugBlocks",
      "renameLocalVariables",
      "aliasRepeatedExpressions",
      "aliasLiterals",
      "simplifyExpressions",
      "removeUnusedLocals",
      "removeUnusedFunctions",
      "renameTableFields",
      "packLocalDeclarations",
   ];
   return booleanKeys.every((key) => typeof options[key] === "boolean")
      && typeof options.maxIndentLevel === "number"
      && Number.isFinite(options.maxIndentLevel)
      && typeof options.maxLineLength === "number"
      && Number.isFinite(options.maxLineLength)
      && ["pretty", "tight", "single-line-blocks"].includes(options.lineBehavior ?? "")
      && Array.isArray(options.functionNamesToKeep)
      && options.functionNamesToKeep.every((name) => typeof name === "string")
      && Array.isArray(options.tableEntryKeysToRename)
      && options.tableEntryKeysToRename.every((name) => typeof name === "string");
}

export function parseExportConfigurationClipboardPayload(value: unknown): ExportConfiguration | null {
   if (!value || typeof value !== "object") return null;
   const payload = value as Partial<ExportConfigurationClipboardPayload>;
   const configuration = payload.configuration as Partial<ExportConfigurationDto> | undefined;
   if (payload.type !== ExportConfigurationClipboardType
      || payload.version !== 1
      || !configuration
      || typeof configuration.name !== "string"
      || !isValidExportConfigurationName(configuration.name)
      || !isOptimizationRuleOptions(configuration.minificationOptions)
      || typeof configuration.useCustomEntrypointLua !== "boolean"
      || typeof configuration.customEntrypointLua !== "string"
      || typeof configuration.exportCueSheet !== "boolean"
      || !Array.isArray(configuration.cueSheetFields)
      || !configuration.cueSheetFields.every((field) => (
         CueSheetFieldValues.includes(field as CueSheetField)
      ))) {
      return null;
   }

   try {
      return new ExportConfiguration(configuration);
   } catch {
      return null;
   }
}

export function makeDefaultExportConfigurations(args: {
   releaseMinificationOptions?: OptimizationRuleOptions;
   useCustomEntrypointLua?: boolean;
   customEntrypointLua?: string;
   exportCueSheet?: boolean;
   cueSheetFields?: CueSheetField[];
} = {}): ExportConfiguration[] {
   const sharedSettings = {
      useCustomEntrypointLua: CoalesceBoolean(args.useCustomEntrypointLua, false),
      customEntrypointLua: args.customEntrypointLua ?? "",
      exportCueSheet: CoalesceBoolean(args.exportCueSheet, true),
      cueSheetFields: normalizeCueSheetFields(args.cueSheetFields),
   };
   return [
      new ExportConfiguration({
         name: "Debug",
         minificationOptions: kDefaultDebugMinificationOptions,
         ...sharedSettings,
      }),
      new ExportConfiguration({
         name: "Release",
         minificationOptions: args.releaseMinificationOptions ?? kDefaultReleaseMinificationOptions,
         ...sharedSettings,
      }),
   ];
}
