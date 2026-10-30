/** ZIP STORE writer with UTF-8 filenames, CRC32, central directory and no extra dependencies. */
const encoder=new TextEncoder();
const table=new Uint32Array(256);
for(let i=0;i<256;i++){let crc=i;for(let j=0;j<8;j++)crc=crc&1 ? 0xedb88320^(crc>>>1) : crc>>>1;table[i]=crc>>>0;}
function crc32(data:Uint8Array):number {let c=0xffffffff;for(const v of data)c=table[(c^v)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function u16(view:DataView,offset:number,val:number){view.setUint16(offset,val,true);}
function u32(view:DataView,offset:number,val:number){view.setUint32(offset,val>>>0,true);}
export function zipFiles(files:Record<string,string>):Blob {
 const paths=Object.keys(files).sort();
 if(paths.length>65535)throw Error('Muitos arquivos ZIP');
 const local:Uint8Array[]=[];const central:Uint8Array[]=[];
 let cursor=0;
 for(const path of paths){
  if(!/^config\/[\w.\-]+\.json$/.test(path))throw Error('Caminho ZIP inválido');
  const name=encoder.encode(path),data=encoder.encode(files[path]),checksum=crc32(data);
  const first=new Uint8Array(30+name.length+data.length),f=new DataView(first.buffer);
  u32(f,0,0x04034b50);u16(f,4,20);u16(f,6,0x0800);u16(f,8,0);u32(f,14,checksum);
  u32(f,18,data.length);u32(f,22,data.length);u16(f,26,name.length);
  first.set(name,30);first.set(data,30+name.length);local.push(first);
  const directory=new Uint8Array(46+name.length),d=new DataView(directory.buffer);
  u32(d,0,0x02014b50);u16(d,4,20);u16(d,6,20);u16(d,8,0x0800);u16(d,10,0);
  u32(d,16,checksum);u32(d,20,data.length);u32(d,24,data.length);u16(d,28,name.length);
  u32(d,42,cursor);directory.set(name,46);central.push(directory);
  cursor+=first.length;
 }
 const centralSize=central.reduce((sum,x)=>sum+x.length,0);
 const end=new Uint8Array(22),e=new DataView(end.buffer);
 u32(e,0,0x06054b50);u16(e,8,paths.length);u16(e,10,paths.length);
 u32(e,12,centralSize);u32(e,16,cursor);
 return new Blob([...local,...central,end],{type:'application/zip'});
}
