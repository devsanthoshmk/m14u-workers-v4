import { Innertube } from 'youtubei.js/web';

globalThis.addEventListener('message', async ({ data }: MessageEvent) => {
  try {
    if (!/^[\w-]{11}$/.test(data?.videoId ?? '')) throw new Error('Invalid video ID');
    const yt = await Innertube.create({ generate_session_locally: true });
    const info = await yt.getBasicInfo(data.videoId);
    const format = info.chooseFormat({ type: 'audio', quality: 'best' });
    const url = await format.decipher(yt.session.player);
    globalThis.postMessage({ title: info.basic_info.title, adaptiveFormats: [{
      url, type: format.mime_type, bitrate: String(format.bitrate), encoding: '',
    }] });
  } catch {
    globalThis.postMessage(null);
  }
});
