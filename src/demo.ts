import { waveformPeaks } from './engine/audio';
import { defaultAudio, defaultVideo, defaultTracks, type MediaAsset, type Project } from './types';
export function createDemo(): {project: Project; assets: MediaAsset[]} {
  const base = import.meta.env?.BASE_URL || './';
  const assets: MediaAsset[] = [
    { id: 'mountain', name: '01 · Гірські вершини.jpg', kind: 'image', url: `${base}demo-mountains.jpg`, thumbnail: `${base}demo-mountains.jpg`, duration: 12, width: 1600, height: 1067, demo: true },
    { id: 'forest', name: '02 · Подих лісу.jpg', kind: 'image', url: `${base}demo-forest.jpg`, thumbnail: `${base}demo-forest.jpg`, duration: 12, demo: true },
    { id: 'lake', name: '03 · Дзеркало озера.jpg', kind: 'image', url: `${base}demo-lake.jpg`, thumbnail: `${base}demo-lake.jpg`, duration: 12, demo: true },
  ];
  const sr = 16000, duration = 36, buffer = new AudioBuffer({ length: sr * duration, sampleRate: sr, numberOfChannels: 1 });
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) { const t = i / sr; const fade = Math.min(t / 2, (duration - t) / 3, 1); samples[i] = fade * (.022 * Math.sin(2 * Math.PI * 130.81 * t) + .018 * Math.sin(2 * Math.PI * 196 * t) + .012 * Math.sin(2 * Math.PI * 261.63 * t)) * (.7 + .3 * Math.sin(t * .6)); }
  const wav = new ArrayBuffer(44 + samples.length * 2), view = new DataView(wav);
  const word = (offset: number, text: string) => [...text].forEach((c,i)=>view.setUint8(offset+i,c.charCodeAt(0)));
  word(0,'RIFF'); view.setUint32(4,wav.byteLength-8,true); word(8,'WAVE'); word(12,'fmt '); view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true); view.setUint32(24,sr,true); view.setUint32(28,sr*2,true); view.setUint16(32,2,true); view.setUint16(34,16,true); word(36,'data'); view.setUint32(40,samples.length*2,true); samples.forEach((s,i)=>view.setInt16(44+i*2,s*32767,true));
  const file = new File([wav], 'Тиха висота · ambient.wav', {type:'audio/wav'});
  assets.push({id:'ambient',name:file.name,kind:'audio',url:URL.createObjectURL(file),duration,audioBuffer:buffer,file,waveform:waveformPeaks(buffer,160)});
  const project: Project = { name: 'На висоті тиші', tracks:defaultTracks(), width:1920,height:1080,fps:25,mutedTracks:[],hiddenTracks:[],subtitleStyle:{size:48,color:'#ffffff',background:true},subtitles:[{id:'sub1',start:2,end:9,text:'Там, де починається тиша.'},{id:'sub2',start:14,end:20,text:'І кожен момент має значення.'},{id:'sub3',start:27,end:33,text:'Збережи свою історію.'}],clips:[
    ...['mountain','forest','lake'].map((assetId,i)=>({id:`demo-${i}`,assetId,trackId:'v1',name:assets[i].name,start:i*12,in:0,duration:12,muted:false,audio:defaultAudio(),video:{...defaultVideo(),fadeIn:i===0?1:0,fadeOut:i===2?1:0}})),
    {id:'ambient-clip',assetId:'ambient',trackId:'a1',name:'Тиха висота · ambient.wav',start:0,in:0,duration:36,muted:false,audio:{...defaultAudio(),gain:-3},video:defaultVideo()}
  ] };
  return {project,assets};
}
