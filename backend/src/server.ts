import express, {type ErrorRequestHandler} from "express";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {adapter} from "./http/adapter";
import * as workspace from "./routes/workspace";
import * as research from "./routes/research";
import * as billing from "./routes/billing";
import * as topics from "./routes/topics";

const development=process.env.NODE_ENV==="development";
const host=development?"127.0.0.1":process.env.HOST||"127.0.0.1";
const origin=new URL(process.env.APP_BASE_URL||(development?"http://127.0.0.1:5173":"")).origin;
const app=express();
app.disable("x-powered-by");
app.use("/api",(req,res,next)=>{
  // En production, seul le proxy OIDC interne peut joindre ce port.
  if(development)req.headers["x-manuscrit-user"]="local-development";
  if(!req.headers["x-manuscrit-user"]){res.sendStatus(403);return}
  if(req.method==="POST"&&req.headers.origin!==origin){res.sendStatus(403);return}
  next();
});
// Bodies are parsed as raw buffers for Fetch adapters — never logged.
app.use(["/api/research","/api/billing","/api/topics"],express.raw({type:()=>true,limit:"256kb"}));
app.get("/api/workspace",adapter(workspace.GET,origin));
app.post("/api/workspace",adapter(workspace.POST,origin));
app.post("/api/research",adapter(research.POST,origin));
app.post("/api/research/plan-docx",adapter(research.POST_planDocx,origin));
app.get("/api/billing",adapter(billing.GET,origin));
app.post("/api/billing",adapter(billing.POST,origin));
app.post("/api/topics/draft",adapter(topics.POST_draft,origin));
app.post("/api/topics/generate",adapter(topics.POST_generate,origin));
app.post("/api/topics/regenerate",adapter(topics.POST_regenerate,origin));
app.post("/api/topics/document",adapter(topics.POST_document,origin));
app.use("/api",(_req,res)=>{res.sendStatus(404)});
const assets=resolve(dirname(fileURLToPath(import.meta.url)),"../../frontend/dist");
app.use(express.static(assets));
const failure:ErrorRequestHandler=(error,_req,res,next)=>{
  if(res.headersSent){next(error);return}
  const status=error.status===413?413:500;
  res.status(status).json({error:status===413?"Demande trop volumineuse.":"Service temporairement indisponible."});
};
app.use(failure);
app.listen(Number(process.env.PORT||3000),host,()=>console.info("Manuscrit : serveur prêt."));
