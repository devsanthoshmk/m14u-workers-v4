/**
 * SilenceDetectorProcessor — AudioWorklet that detects the first non-silent
 * audio sample flowing through the pipeline.
 *
 * Used as a trigger to determine when audio actually starts rendering,
 * so the main thread can compute the precise wall-clock playback origin.
 *
 * Messages IN:
 *   { type: 'RESET' }  — rearm the detector (call before each new song)
 *
 * Messages OUT:
 *   { type: 'AUDIO_STARTED' }  — first non-silent sample detected
 */
class SilenceDetectorProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._armed = false;
    this._detected = false;
    this._threshold = 0.0001; // amplitude threshold to distinguish from idle zeros

    this.port.onmessage = (e) => {
      if (e.data?.type === 'RESET') {
        this._armed = true;
        this._detected = false;
      }
    };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];

    // Pass-through: copy input to output so audio is not interrupted
    if (input && output) {
      for (let ch = 0; ch < input.length; ch++) {
        if (input[ch] && output[ch]) {
          output[ch].set(input[ch]);
        }
      }
    }

    // Only scan when armed and not yet detected
    if (!this._armed || this._detected) return true;

    if (input && input.length > 0) {
      for (let ch = 0; ch < input.length; ch++) {
        const channelData = input[ch];
        if (!channelData) continue;
        for (let i = 0; i < channelData.length; i++) {
          if (Math.abs(channelData[i]) > this._threshold) {
            this._detected = true;
            this.port.postMessage({ type: 'AUDIO_STARTED' });
            return true;
          }
        }
      }
    }

    return true; // keep processor alive
  }
}

registerProcessor('silence-detector-processor', SilenceDetectorProcessor);
