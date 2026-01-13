
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
type EnumDef = Record<string, {value: EnumValue}&Record<string, any>>;

type EnumKey<D extends EnumDef> = keyof D&string;
type EnumVal<D extends EnumDef> = D[EnumKey<D>]["value"];

type EnumInfoUnion<D extends EnumDef> = {
   [K in EnumKey<D>]: {key: K}&D[K]
}[EnumKey<D>];

export function defineEnum<const D extends EnumDef>(def: D) {
   const keys = typedKeys(def);

   // key.TIC80 -> "TIC80"
   const key = Object.fromEntries(keys.map((k) => [k, k])) as {
      [K in EnumKey<D>]: K;
   };

   // valueByKey.TIC80 -> 1
   const valueByKey = Object.fromEntries(keys.map((k) => [k, def[k].value])) as {
      [K in EnumKey<D>]: D[K]["value"];
   };

   // infoByKey.TIC80 -> {value, title, ...}
   const infoByKey = def;

   const values = keys.map((k) => valueByKey[k]) as EnumVal<D>[];

   const infos = keys.map((k) => ({key: k, ...def[k]})) as EnumInfoUnion<D>[];

   // Reverse lookups (Map handles number keys cleanly)
   const keyByValue = new Map<EnumVal<D>, EnumKey<D>>();
   const infoByValue = new Map<EnumVal<D>, EnumInfoUnion<D>>();

   for (const k of keys) {
      const v = valueByKey[k] as EnumVal<D>;
      // Optional: detect duplicate values (uncomment if you want hard fail)
      // if (keyByValue.has(v)) throw new Error(`Duplicate enum value: ${String(v)}`);
      keyByValue.set(v, k);
      infoByValue.set(v, infos.find((x) => x.key === k)! as EnumInfoUnion<D>);
   }

   // phantom fields for type extraction convenience
   const $key = null as unknown as EnumKey<D>;
   const $value = null as unknown as EnumVal<D>;

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
      $key,
      $value,
   } as const;
}
