import {useEffect, useState} from "react";


export function useLocalStorage<T>(key: string, defaultValue: T): [T, (value: T|((prev: T) => T)) => void] {
   const readValue = (): T => {
      if (typeof window === "undefined")
         return defaultValue;
      try {
         const raw = window.localStorage.getItem(key);
         return raw !== null ? (JSON.parse(raw) as T) : defaultValue;
      } catch (err) {
         console.warn("useLocalStorage: read failed", err);
         return defaultValue;
      }
   };

   const [value, setValue] = useState<T>(readValue);

   const setStoredValue = (v: T|((prev: T) => T)) => {
      setValue(prev => (v instanceof Function ? v(prev) : v));
   };

   useEffect(() => {
      if (typeof window === "undefined")
         return;
      try {
         window.localStorage.setItem(key, JSON.stringify(value));
      } catch (err) {
         console.warn("useLocalStorage: write failed", err);
      }
   }, [key, value]);

   return [value, setStoredValue];
}
