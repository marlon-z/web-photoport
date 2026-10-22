import sharp from 'sharp';
import {readFile} from 'node:fs/promises';
import {DemoSource} from './adapters.mjs';
let artwork;
export async function demoSource(options){
  const source=new DemoSource(options);
  if(!options.visual)return source;
  artwork??=readFile(new URL('../public/assets/products.png',import.meta.url)).then(bytes=>Promise.all([0,1,2,3].map(i=>sharp(bytes).extract({left:(i%2)*627,top:Math.floor(i/2)*627,width:627,height:627}).png().toBuffer())));
  const images=await artwork,names=['经典帆布鞋','无线头戴耳机','日常护理系列','小号肩背包'];
  for(const record of source.records){
    const index=Math.floor((Number(record.id.replace('recDemo',''))-1)/2)%4;
    if(!Number.isInteger(index)||index<0)continue;
    record.fields.Name=names[index]+' · '+record.fields.SKU;
    for(const file of [...record.fields.Photos,...record.fields.Details]){
      if(!source.files.has(file.id))continue;
      source.files.set(file.id,images[index]);file.size=images[index].length;
    }
  }
  return source;
}
