import {useEffect, useMemo, useState} from "react";

export type SetStateAction<T> = T|((prev: T) => T);
export type Lazy<T> = T|(() => T);

export type StorageCodec<T> = {
   serialize: (value: T) => string; //
   deserialize: (raw: string) => T;
};

const jsonCodec: StorageCodec<any> = {
   serialize: (v) => JSON.stringify(v), //
   deserialize: (raw) => JSON.parse(raw),
};

export function useLocalStorage<T>(
   key: string,            //
   defaultValue: Lazy<T>,  //
   codec?: StorageCodec<T> //
   ): [T, (value: SetStateAction<T>) => void] {
   const codecUsed = useMemo<StorageCodec<T>>(() => (codec ?? (jsonCodec as StorageCodec<T>)), [codec]);

   const readValue = (): T => {
      const fallback = (): T => (typeof defaultValue === "function" ? (defaultValue as () => T)() : defaultValue);

      if (typeof window === "undefined")
         return fallback();

      try {
         const raw = window.localStorage.getItem(key);
         return raw !== null ? codecUsed.deserialize(raw) : fallback();
      } catch (err) {
         console.warn("useLocalStorage: read failed", err);
         return fallback();
      }
   };

   const [value, setValue] = useState<T>(readValue);

   const setStoredValue = (v: SetStateAction<T>) => {
      setValue(prev => (typeof v === "function" ? (v as (p: T) => T)(prev) : v));
   };

   useEffect(() => {
      if (typeof window === "undefined")
         return;

      try {
         window.localStorage.setItem(key, codecUsed.serialize(value));
      } catch (err) {
         console.warn("useLocalStorage: write failed", err);
      }
   }, [key, value, codecUsed]);

   return [value, setStoredValue];
}
