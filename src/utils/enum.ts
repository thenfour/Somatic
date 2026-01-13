
// utility to define enums with all the extras without needing tons of boilerplate and symbols scattered around

import {typedKeys} from "./utils";

// export const SubsystemType = defineEnum({
//    TIC80: {
//       value: 1,
//       title: "TIC-80",
//    },
//    AMIGAMOD: {
//       value: 2,
//       title: "Amiga MOD",
//    },
// } as const);

// // values
// SubsystemType.keys;   // ("TIC80" | "AMIGAMOD")[]
// SubsystemType.values; // (1 | 2)[]
// SubsystemType.infos;  // {key, value, title}[]
// SubsystemType.key.TIC80;       // "TIC80"

// SubsystemType.Value.TIC80;           // 1
// SubsystemType.byKey.TIC80.title;     // "TIC-80"
// SubsystemType.byValue.get(2)?.title; // "Amiga MOD"

// // types
// export type SubsystemTypeKey = typeof SubsystemType.$key;     // "TIC80" | "AMIGAMOD"
// export type SubsystemTypeValue = typeof SubsystemType.$value; // 1 | 2
// export type SubsystemTypeInfo = (typeof SubsystemType.infos)[number];


type EnumValue = string|number;

// the input definition.
// requires at least a "value" field, can have any other fields.
type EnumDef = Record<string, {value: EnumValue}&Record<string, any>>;

type EnumKeyUnion<D extends EnumDef> = keyof D;                       // the type union of the keys of the definition
type EnumValueUnion<D extends EnumDef> = D[EnumKeyUnion<D>]["value"]; // the type union of the "value" fields

// record of all "infos", by key
// "infos" are the full entries with key field added
type EnumInfo<D extends EnumDef, K extends EnumKeyUnion<D>> = {
   key: K
}&D[K];
type EnumInfoUnion<D extends EnumDef> = {
   [K in EnumKeyUnion<D>]: {key: K}&D[K];
}[EnumKeyUnion<D>];

const ExampleDef = {
   A: {value: 1, title: "First"},
   B: {value: 2, title: "Second"},
} as const;

type ExampleKey = EnumKeyUnion<typeof ExampleDef>;   // "A" | "B"
type ExampleVal = EnumValueUnion<typeof ExampleDef>; // 1 | 2
type ExampleInfoA = EnumInfo<typeof ExampleDef, "A">;

// now let's make a type which unions all infos.
// {key: "A", value: 1, title: "First"} | {key: "B", value: 2, title: "Second"}
type ExampleInfoUnion = EnumInfoUnion<typeof ExampleDef>;

export function defineEnum<const D extends EnumDef>(def: D) {
   const keys = typedKeys(def);

   // key.TIC80 -> "TIC80"
   const key = Object.fromEntries(keys.map((k) => [k, k])) as {
      [K in EnumKeyUnion<D>]: K;
   };

   // valueByKey.TIC80 -> 1
   const valueByKey = Object.fromEntries(keys.map((k) => [k, def[k].value])) as {
      [K in EnumKeyUnion<D>]: D[K]["value"];
   };

   const values = keys.map((k) => valueByKey[k]) as EnumValueUnion<D>[];

   const infos = keys.map((k) => ({key: k, ...def[k]})) as EnumInfoUnion<D>[];

   // Reverse lookups (Map handles number keys cleanly)
   const keyByValue = new Map<EnumValueUnion<D>, EnumKeyUnion<D>>();
   const infoByValue = new Map<EnumValueUnion<D>, EnumInfoUnion<D>>();
   const infoByKey = Object.fromEntries(keys.map((k) => [k, {key: k, ...def[k]}])) as {
      [K in EnumKeyUnion<D>]: EnumInfo<D, K>;
   };

   for (const k of keys) {
      const v = valueByKey[k] as EnumValueUnion<D>;
      // Optional: detect duplicate values (uncomment to hard fail)
      // if (keyByValue.has(v)) throw new Error(`Duplicate enum value: ${String(v)}`);
      keyByValue.set(v, k);
      infoByValue.set(v, infos.find((x) => x.key === k)! as EnumInfoUnion<D>);
   }

   // phantom fields for type extraction convenience
   const $key = null as unknown as EnumKeyUnion<D>;
   const $value = null as unknown as EnumValueUnion<D>;
   const $info = null as unknown as EnumInfoUnion<D>;

   function _coerceByKey(k: any): EnumInfoUnion<D>|undefined;
   function _coerceByKey(k: any, fallbackKey: keyof typeof def): EnumInfoUnion<D>;
   function _coerceByKey(k: any, fallbackKey?: keyof typeof def|undefined) {
      if (typeof k !== "string") {
         return fallbackKey ? infoByKey[fallbackKey as EnumKeyUnion<D>] : undefined;
      }
      if (k in def) {
         return infoByKey[k as EnumKeyUnion<D>];
      }
      return fallbackKey ? infoByKey[fallbackKey as EnumKeyUnion<D>] : undefined;
   }

   function _coerceByValue(v: any): EnumInfoUnion<D>|undefined;
   function _coerceByValue(v: any, fallbackKey: keyof typeof def): EnumInfoUnion<D>;
   function _coerceByValue(v: any, fallbackKey?: keyof typeof def|undefined) {
      const info = infoByValue.get(v as EnumValueUnion<D>);
      if (info) {
         return info;
      }
      return fallbackKey ? infoByKey[fallbackKey as EnumKeyUnion<D>] : undefined;
   }

   function _coerceByValueOrKey(vk: any): EnumInfoUnion<D>|undefined;
   function _coerceByValueOrKey(vk: any, fallbackKey: keyof typeof def): EnumInfoUnion<D>;
   function _coerceByValueOrKey(vk: any, fallbackKey?: keyof typeof def) {
      // prefer key first
      const infoByKeyResult = _coerceByKey(vk);
      if (infoByKeyResult) {
         return infoByKeyResult;
      }
      if (fallbackKey === undefined) {
         return _coerceByValue(vk);
      }
      return _coerceByValue(vk, fallbackKey);
   }

   return {
      byKey: def,
      key,
      valueByKey,
      infoByKey,
      keys,
      values,
      infos,
      keyByValue,
      infoByValue,
      coerceByKey: _coerceByKey,
      coerceByValue: _coerceByValue,
      coerceByValueOrKey: _coerceByValueOrKey,
      $key,
      $value,
      $info,
   } as const;
}
