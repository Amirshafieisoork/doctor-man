export function matchesFileType(buffer,mimeType){
  if(!Buffer.isBuffer(buffer)||buffer.length===0)return false;
  if(mimeType==='image/jpeg')return buffer.length>=3&&buffer[0]===0xff&&buffer[1]===0xd8&&buffer[2]===0xff;
  if(mimeType==='image/png')return buffer.length>=8&&buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if(mimeType==='image/webp')return buffer.length>=12&&buffer.subarray(0,4).toString('ascii')==='RIFF'&&buffer.subarray(8,12).toString('ascii')==='WEBP';
  if(mimeType==='application/pdf')return buffer.length>=5&&buffer.subarray(0,5).toString('ascii')==='%PDF-';
  return false;
}
