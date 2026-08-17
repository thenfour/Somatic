// https://github.com/thenfour/WaveSabre/blob/master/WaveSabreCore/Filters/DCFilter.hpp
const DC_FILTER_FEEDBACK = 0.998;

export class AudioRenderDcFilter {
   private previousInput = 0;
   private previousOutput = 0;

   processSample(input: number): number {
      const output = input - this.previousInput + DC_FILTER_FEEDBACK * this.previousOutput;
      this.previousInput = input;
      this.previousOutput = output;
      return output;
   }
}
