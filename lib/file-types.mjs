// File formats that the export can preserve without executing or converting them.
export const FILE_TYPES={
  'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','image/tiff':'tif','image/heic':'heic','image/avif':'avif',
  'application/pdf':'pdf','text/plain':'txt','text/csv':'csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation':'pptx',
  'application/msword':'doc','application/vnd.ms-excel':'xls','application/vnd.ms-powerpoint':'ppt',
  'application/zip':'zip','audio/mpeg':'mp3','audio/wav':'wav','audio/x-wav':'wav','video/mp4':'mp4','video/quicktime':'mov'
};
export function matchesFile(bytes,type) {
  if(type==='image/png')return bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if(type==='image/jpeg')return bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  if(type==='image/webp')return bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
  if(type==='image/gif')return /^GIF8[79]a/.test(bytes.subarray(0,6).toString());
  if(type==='image/tiff')return ['49492a00','4d4d002a'].includes(bytes.subarray(0,4).toString('hex'));
  if(['image/heic','image/avif','video/mp4','video/quicktime'].includes(type))return bytes.subarray(4,8).toString()==='ftyp';
  if(type==='application/pdf')return bytes.subarray(0,1024).includes(Buffer.from('%PDF-'));
  if(type==='application/zip'||type.includes('openxmlformats'))return bytes[0]===80&&bytes[1]===75;
  if(['application/msword','application/vnd.ms-excel','application/vnd.ms-powerpoint'].includes(type))return bytes.subarray(0,8).toString('hex')==='d0cf11e0a1b11ae1';
  if(type==='audio/mpeg')return bytes.subarray(0,3).toString()==='ID3'||bytes[0]===255&&(bytes[1]&224)===224;
  if(type==='audio/wav'||type==='audio/x-wav')return bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WAVE';
  if(type==='text/plain'||type==='text/csv')return !bytes.includes(0);
  return false;
}
