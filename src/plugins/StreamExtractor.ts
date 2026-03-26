import { registerPlugin } from '@capacitor/core';

export interface StreamExtractorPlugin {
  getStreamUrl(options: { videoId: string; quality?: string }): Promise<{
    url: string;
    type: string;
    bitrate: number;
    codec: string;
  }>;
  getStreamData(options: { videoId: string }): Promise<{
    adaptiveFormats: Array<{
      url: string;
      type: string;
      bitrate: string;
      encoding: string;
    }>;
    title: string;
  }>;
}

const StreamExtractor = registerPlugin<StreamExtractorPlugin>('StreamExtractor');
export default StreamExtractor;
