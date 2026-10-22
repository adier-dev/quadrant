/* Minimal ZIP32 reader/writer for local backups. Stored output; stored/deflated input. */
'use strict';
window.ZipCodec = (() => {
  const enc = new TextEncoder(), dec = new TextDecoder();
  const table = Array.from({length:256},(_,i)=>{let n=i;for(let b=0;b<8;b++) n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
  const crc = bytes => {let n=0xffffffff;for(const b of bytes)n=table[(n^b)&255]^(n>>>8);return (n^0xffffffff)>>>0;};
  const header = n => ({bytes:new Uint8Array(n),view:null});
  function pack(files) {
    const parts=[], directory=[];let offset=0, size=0;
    for(const [name,bytes] of files) {
      const filename=enc.encode(name), hash=crc(bytes), local=header(30+filename.length), central=header(46+filename.length);
      const a=new DataView(local.bytes.buffer), b=new DataView(central.bytes.buffer);
      a.setUint32(0,0x04034b50,true);a.setUint16(4,20,true);a.setUint16(6,0x800,true);
      a.setUint32(14,hash,true);a.setUint32(18,bytes.length,true);a.setUint32(22,bytes.length,true);a.setUint16(26,filename.length,true);local.bytes.set(filename,30);
      b.setUint32(0,0x02014b50,true);b.setUint16(4,20,true);b.setUint16(6,20,true);b.setUint16(8,0x800,true);
      b.setUint32(16,hash,true);b.setUint32(20,bytes.length,true);b.setUint32(24,bytes.length,true);b.setUint16(28,filename.length,true);b.setUint32(42,offset,true);central.bytes.set(filename,46);
      parts.push(local.bytes,bytes);directory.push(central.bytes);offset+=local.bytes.length+bytes.length;size+=central.bytes.length;
    }
    const end=new Uint8Array(22), v=new DataView(end.buffer);
    v.setUint32(0,0x06054b50,true);v.setUint16(8,files.length,true);v.setUint16(10,files.length,true);v.setUint32(12,size,true);v.setUint32(16,offset,true);
    return new Blob([...parts,...directory,end],{type:'application/zip'});
  }
  async function unpack(buffer) {
    const bytes=new Uint8Array(buffer), v=new DataView(buffer);let end=-1;
    for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--)if(v.getUint32(p,true)===0x06054b50){end=p;break;}
    if(end<0)throw new Error('备份 ZIP 格式不正确');
    const count=v.getUint16(end+10,true);let cursor=v.getUint32(end+16,true), total=0;const result=new Map();
    if(count>20000)throw new Error('备份文件数量超出限制');
    for(let i=0;i<count;i++) {
      if(v.getUint32(cursor,true)!==0x02014b50)throw new Error('备份目录损坏');
      const method=v.getUint16(cursor+10,true), packed=v.getUint32(cursor+20,true), size=v.getUint32(cursor+24,true), nameLength=v.getUint16(cursor+28,true);
      const name=dec.decode(bytes.slice(cursor+46,cursor+46+nameLength)), pos=v.getUint32(cursor+42,true), hash=v.getUint32(cursor+16,true);
      total+=size;if(total>256*1024*1024)throw new Error('备份解压后不能超过 256 MB');
      if(pos+30>bytes.length||v.getUint32(pos,true)!==0x04034b50)throw new Error('备份文件头损坏');
      const start=pos+30+v.getUint16(pos+26,true)+v.getUint16(pos+28,true);
      if(start+packed>bytes.length)throw new Error('备份文件不完整');
      let data=bytes.slice(start,start+packed);
      if(method===8) {
        const reader=new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader(), chunks=[];let length=0;
        while(true){const next=await reader.read();if(next.done)break;length+=next.value.length;if(length>size){await reader.cancel();throw new Error('备份容量校验失败');}chunks.push(next.value);}
        data=new Uint8Array(await new Blob(chunks).arrayBuffer());
      } else if(method!==0)throw new Error('不支持此 ZIP 压缩格式');
      if(data.length!==size||crc(data)!==hash||result.has(name))throw new Error('备份文件校验失败或重复');
      result.set(name,data);cursor+=46+nameLength+v.getUint16(cursor+30,true)+v.getUint16(cursor+32,true);
    }
    return result;
  }
  return {pack,unpack};
})();
