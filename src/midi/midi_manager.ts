
export type MidiDevice = {
   id: string;            //
   name: string;          //
   manufacturer?: string; //
   state: string;         //
};

export type MidiNoteEvent = {
   note: number;     //
   velocity: number; //
   channel: number;  //
   deviceId: string; //
};

type Listener<T> = (payload: T) => void;

export type MidiStatus = "unsupported"|"pending"|"ready"|"denied"|"error";

/** Simple WebMIDI manager: listens to all inputs and dispatches note on/off */
export class MidiManager {
   private status: MidiStatus = "pending";
   private devices: MidiDevice[] = [];
   private noteOnListeners = new Set<Listener<MidiNoteEvent>>();
   private noteOffListeners = new Set<Listener<MidiNoteEvent>>();
   private deviceListeners = new Set<Listener<MidiDevice[]>>();
   private access: WebMidi|null = null;
   private enabled: boolean = true;

   async init(): Promise<void> {
      console.log("[MidiManager] Initializing MIDI...");
      if (!navigator.requestMIDIAccess) {
         this.status = "unsupported";
         console.warn("[MidiManager] Web MIDI API not supported in this browser.");
         this.emitDevices();
         return;
      }
      this.status = "pending";
      try {
         const access = await navigator.requestMIDIAccess({sysex: false});
         this.access = access as unknown as WebMidi;
         this.status = "ready";
         access.onstatechange = () => this.refreshDevices();
         this.attachInputs();
         this.refreshDevices();
      } catch (err) {
         console.warn("[MidiManager] Error accessing MIDI devices", err);
         this.status = "denied";
         console.warn("[MidiManager] MIDI access denied", err);
      }
      this.emitDevices();
   }

   getStatus(): MidiStatus {
      return this.status;
   }

   getDevices(): MidiDevice[] {
      return [...this.devices];
   }

   onDevicesChanged(cb: Listener<MidiDevice[]>): () => void {
      this.deviceListeners.add(cb);
      cb(this.getDevices());
      return () => this.deviceListeners.delete(cb);
   }

   onNoteOn(cb: Listener<MidiNoteEvent>): () => void {
      this.noteOnListeners.add(cb);
      return () => this.noteOnListeners.delete(cb);
   }

   onNoteOff(cb: Listener<MidiNoteEvent>): () => void {
      this.noteOffListeners.add(cb);
      return () => this.noteOffListeners.delete(cb);
   }

   setEnabled(enabled: boolean): void {
      this.enabled = enabled;
      console.log(`[MidiManager] MIDI input ${enabled ? "enabled" : "disabled"}`);
   }

   isEnabled(): boolean {
      return this.enabled;
   }

   private emitDevices() {
      const list = this.getDevices();
      this.deviceListeners.forEach((cb) => cb(list));
   }

   private refreshDevices() {
      if (!this.access)
         return;
      const next: MidiDevice[] = [];
      this.access.inputs.forEach((input) => {
         next.push({
            id: input.id,
            name: input.name || "Unknown device",
            manufacturer: input.manufacturer || undefined,
            state: input.state,
         });
      });
      this.devices = next;
      this.emitDevices();
      this.attachInputs();
   }

   private attachInputs() {
      if (!this.access)
         return;
      this.access.inputs.forEach((input) => {
         // Remove any existing to avoid duplicate handlers
         input.onmidimessage = null;
         input.onmidimessage = (evt: MIDIMessageEvent) => this.handleMessage(input.id, evt);
      });
   }

   private handleMessage(deviceId: string, evt: MIDIMessageEvent) {
      const data = Array.from(evt.data || []);
      const [status, data1, data2] = data;
      const command = status & 0xf0;
      const channel = status & 0x0f;
      const velocity = data2 ?? 0;
      if (command === 0x90 && velocity > 0) {
         this.dispatchNote(true, {note: data1, velocity, channel, deviceId});
      } else if (command === 0x80 || (command === 0x90 && velocity === 0)) {
         this.dispatchNote(false, {note: data1, velocity, channel, deviceId});
      }
   }

   private dispatchNote(on: boolean, payload: MidiNoteEvent) {
      if (!this.enabled)
         return;
      const listeners = on ? this.noteOnListeners : this.noteOffListeners;
      listeners.forEach((cb) => cb(payload));
   }
}
