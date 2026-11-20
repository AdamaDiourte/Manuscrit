import type {RequestHandler} from "express";
import {Readable} from "node:stream";
import {pipeline} from "node:stream/promises";

// Les contrôleurs utilisent les objets HTTP standard. Les fichiers traversent
// le pont sous forme de flux jusqu'au lecteur qui impose la limite de taille.
export function adapter(handler:(request:Request)=>Promise<Response>,origin:string):RequestHandler {
  return async (req,res,next)=>{
    try {
      const headers=new Headers();
      for(const [name,value] of Object.entries(req.headers)){
        if(value!==undefined)headers.set(name,Array.isArray(value)?value.join(", "):value);
      }
      const options:RequestInit & {duplex?:"half"}={method:req.method,headers};
      if(req.method==="POST"||req.method==="PUT"||req.method==="PATCH"){
        options.body=Buffer.isBuffer(req.body)?new Uint8Array(req.body):Readable.toWeb(req) as ReadableStream<Uint8Array<ArrayBuffer>>;
        options.duplex="half";
      }
      const result=await handler(new Request(origin+req.originalUrl,options));
      res.status(result.status);
      result.headers.forEach((v,k)=>res.setHeader(k,v));
      if(result.body)await pipeline(Readable.fromWeb(result.body as import("node:stream/web").ReadableStream),res);
      else res.end();
    }catch(error){next(error)}
  };
}
